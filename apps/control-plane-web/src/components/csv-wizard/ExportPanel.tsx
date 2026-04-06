"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { Download, Search, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { UploadJobStatus } from '@/types/csv';
import { useAuth } from '@/context/AuthContext';

const CSV_API = process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001';

interface ExportPanelProps {
  projectId: string;
  uploadJobId: string;
  status: UploadJobStatus;
  onExport: () => void;
  onRunSeo: () => void;
  isExporting: boolean;
}

export function ExportPanel({ projectId, uploadJobId, status, onExport, onRunSeo, isExporting }: ExportPanelProps) {
  const { accessToken } = useAuth();
  const [seoRunning, setSeoRunning] = useState(false);
  const [seoDone, setSeoDone] = useState(false);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isGeneratingExport, setIsGeneratingExport] = useState(false);

  // Poll export job status to get the real signed URL
  const pollExport = useCallback(async () => {
    if (!exportJobId || !accessToken) return;
    try {
      const res = await fetch(`${CSV_API}/projects/${projectId}/uploads/${uploadJobId}/exports/${exportJobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ready' && data.signedUrl) {
          setSignedUrl(data.signedUrl);
          setIsGeneratingExport(false);
        } else if (data.status === 'failed') {
          setIsGeneratingExport(false);
          console.error('[Export] Export job failed:', data);
        }
      }
    } catch (err) {
      console.error('Failed to poll export status:', err);
    }
  }, [exportJobId, uploadJobId, projectId, accessToken]);

  useEffect(() => {
    if (!exportJobId || signedUrl) return;
    const interval = setInterval(pollExport, 2000);
    return () => clearInterval(interval);
  }, [exportJobId, signedUrl, pollExport]);

  // Also try to find an existing export job on mount (in case user refreshed the page)
  useEffect(() => {
    if (!accessToken || signedUrl) return;
    async function findExistingExport() {
      try {
        const res = await fetch(`${CSV_API}/projects/${projectId}/uploads/${uploadJobId}/exports`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (res.ok) {
          const exports = await res.json();
          if (Array.isArray(exports) && exports.length > 0) {
            const latest = exports[0]; // ordered desc by createdAt
            if (latest.status === 'ready') {
              setExportJobId(latest.id);
              setSignedUrl(latest.signedUrl || 'ready'); // mark as done even if URL expired
            } else if (latest.status === 'generating' || latest.status === 'queued') {
              setExportJobId(latest.id);
              setIsGeneratingExport(true);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load existing exports:', err);
      }
    }
    findExistingExport();
  }, [accessToken, projectId, uploadJobId, signedUrl]);

  const handleRunSeo = async () => {
    setSeoRunning(true);
    try {
      const res = await fetch(`${CSV_API}/uploads/${uploadJobId}/seo/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        setSeoDone(true);
        onRunSeo();
      }
    } catch (err) {
      console.error('Failed to start SEO:', err);
    } finally {
      setSeoRunning(false);
    }
  };

  const startExport = async () => {
    setIsGeneratingExport(true);
    try {
      const res = await fetch(`${CSV_API}/projects/${projectId}/uploads/${uploadJobId}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ includeSeo: seoDone })
      });
      if (res.ok) {
        const data = await res.json();
        setExportJobId(data.exportJobId);
        onExport();
      } else {
        setIsGeneratingExport(false);
        const err = await res.json();
        console.error('[Export] Failed to start export:', err);
      }
    } catch (err) {
      setIsGeneratingExport(false);
      console.error('Failed to start export:', err);
    }
  };

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!exportJobId || isDownloading) return;
    setIsDownloading(true);
    try {
      // Get a fresh signed URL on demand (never stale)
      const res = await fetch(`${CSV_API}/projects/${projectId}/uploads/${uploadJobId}/exports/${exportJobId}/download`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        // API streams the file directly — download as blob
        const blob = new Blob([await res.arrayBuffer()], { type: 'text/csv' });
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = 'enriched_export.csv';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        // Delay cleanup so the browser has time to start the download
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(blobUrl);
        }, 1000);
      } else {
        console.error('[Export] Failed to get download URL:', await res.text());
      }
    } catch (err) {
      console.error('[Export] Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const isGenerating = isExporting || isGeneratingExport;
  const isDone = !!signedUrl;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground mb-4">
        Your enriched catalog is ready. Optionally generate SEO attributes, then export the final CSV file with all original + enriched columns.
      </p>
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          Enrichment Complete
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your catalog data has been successfully processed and all collisions resolved.
          Ready to generate the final export.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* SEO Panel Component embedded */}
        <Card className="border-blue-100 dark:border-blue-900/50 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-500"></div>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-5 w-5 text-blue-500" />
              SEO Auto-Generation
            </CardTitle>
            <CardDescription>
              Optional: Generate localized Titles and Descriptions to boost search discoverability.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {seoDone ? (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 p-4 rounded-lg flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">SEO generated</p>
                  <p className="text-xs text-emerald-600/80 dark:text-emerald-400">Added SEO metadata columns to output.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch id="seo-toggle" disabled={seoRunning} />
                  <label htmlFor="seo-toggle" className="text-sm font-medium">Enable Russian/English SEO</label>
                </div>
                
                <PermissionGate permission="seo:start">
                  <Button 
                    onClick={handleRunSeo} 
                    disabled={seoRunning || isGenerating}
                    size="sm"
                    className="gap-2 shrink-0"
                  >
                    {seoRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {seoRunning ? 'Generating...' : 'Run SEO Task'}
                  </Button>
                </PermissionGate>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Export Action Card */}
        <Card className={isDone ? 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/10' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5 text-foreground" />
              Final Output
            </CardTitle>
            <CardDescription>
              Generate and download the compiled enriched catalog spreadsheet in standard CSV format.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isDone ? (
               <div className="space-y-4">
                 <div className="bg-primary/5 p-4 rounded-lg flex items-center justify-between border">
                   <span className="text-sm font-mono truncate mr-4 pr-4 border-r">enriched_export.csv</span>
                   <span className="text-xs font-semibold text-primary whitespace-nowrap">File ready</span>
                 </div>
                 <Button onClick={handleDownload} disabled={isDownloading} className="w-full gap-2" size="lg">
                   {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                   {isDownloading ? 'Preparing...' : 'Download CSV'}
                 </Button>
               </div>
            ) : (
                <div className="flex flex-col gap-4">
                   <div className="text-sm text-muted-foreground">
                      This will lock the job and compile the final file on the processing cluster.
                   </div>
                   <PermissionGate permission="export:create">
                      <Button 
                        onClick={startExport} 
                        disabled={isGenerating} 
                        className="w-full"
                        size="lg"
                      >
                        {isGenerating ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Compiling Data...</>
                        ) : (
                          'Lock & Generate Export'
                        )}
                      </Button>
                   </PermissionGate>
                </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

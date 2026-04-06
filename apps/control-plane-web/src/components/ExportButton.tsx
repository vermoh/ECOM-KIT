"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface ExportButtonProps {
  projectId: string;
  uploadId: string;
  status: string;
  includeSeo?: boolean;
}

export const ExportButton: React.FC<ExportButtonProps> = ({ projectId, uploadId, status, includeSeo }) => {
  const { accessToken } = useAuth();
  const [exportStatus, setExportStatus] = useState<'idle' | 'queued' | 'generating' | 'ready' | 'failed'>('idle');
  const CSV_API = process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001';
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const startExport = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/projects/${projectId}/uploads/${uploadId}/export`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ includeSeo: includeSeo || false })
      });
      
      if (!res.ok) throw new Error('Failed to start export');
      
      const data = await res.json();
      setJobId(data.exportJobId);
      setExportStatus('queued');
    } catch (err) {
      console.error(err);
      setExportStatus('failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (jobId && (exportStatus === 'queued' || exportStatus === 'generating')) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/projects/${projectId}/uploads/${uploadId}/exports/${jobId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          const data = await res.json();
          
          if (data.status === 'ready') {
            setExportStatus('ready');
            clearInterval(interval);
          } else if (data.status === 'failed') {
            setExportStatus('failed');
            clearInterval(interval);
          } else {
            setExportStatus(data.status);
          }
        } catch (err) {
          console.error('Polling failed', err);
        }
      }, 2000);
    }

    return () => clearInterval(interval);
  }, [jobId, exportStatus, accessToken, projectId, uploadId]);

  if (status !== 'ready' && status !== 'done' && status !== 'exporting') {
    return null;
  }

  if (exportStatus === 'ready' && jobId) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-2 bg-green-50 border-green-200 text-green-700 hover:bg-green-100 hover:text-green-800"
        onClick={async () => {
          try {
            const res = await fetch(`${CSV_API}/projects/${projectId}/uploads/${uploadId}/exports/${jobId}/download`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) throw new Error('Download failed');
            const blob = new Blob([await res.arrayBuffer()], { type: 'text/csv' });
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = 'enriched_export.csv';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
              document.body.removeChild(link);
              URL.revokeObjectURL(blobUrl);
            }, 1000);
          } catch (err) {
            console.error('[Export] Download error:', err);
          }
        }}
      >
        <Download className="h-4 w-4" />
        Download CSV
      </Button>
    );
  }

  if (exportStatus === 'queued' || exportStatus === 'generating') {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {exportStatus === 'queued' ? 'Queued...' : 'Generating...'}
      </Button>
    );
  }

  if (exportStatus === 'failed') {
    return (
      <Button variant="outline" size="sm" className="gap-2 text-red-600 border-red-200 bg-red-50 hover:bg-red-100" onClick={startExport}>
        <AlertCircle className="h-4 w-4" />
        Retry Export
      </Button>
    );
  }

  return (
    <Button 
      variant="outline" 
      size="sm" 
      className="gap-2" 
      onClick={startExport}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      Export Results
    </Button>
  );
};

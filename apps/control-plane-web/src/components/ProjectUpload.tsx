"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';

interface ProjectUploadProps {
  projectId: string;
  initialJobId?: string | null;
  onUploadComplete?: (jobId: string) => void;
}

export function ProjectUpload({ projectId, initialJobId, onUploadComplete }: ProjectUploadProps) {
  const { accessToken } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [includeSeo, setIncludeSeo] = useState(false);
  const [catalogContext, setCatalogContext] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(initialJobId || null);
  const [status, setStatus] = useState<string | null>(null);
  const [languages, setLanguages] = useState<{id: string, code: string, name: string, nativeName: string}[]>([]);
  const [selectedLang, setSelectedLang] = useState<string>('');

  const pollStatus = useCallback(async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${id}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await res.json();
        setStatus(data.status);
        if (data.status === 'parsed') {
          // Only fire on 'parsed' — page needs to show ValidationSummary first.
          // 'schema_draft' means AI ran fast, but user MUST still confirm Validation.
          clearInterval(interval);
          if (onUploadComplete) {
            onUploadComplete(id);
          }
        } else if (['schema_draft', 'schema_review', 'schema_confirmed', 'enriching', 'enriched', 'needs_collision_review', 'ready', 'done'].includes(data.status)) {
          // Backend raced ahead past `parsed` (e.g., AI schema gen completed before first poll tick).
          // Still fire the callback — the page will land on PARSED because `mapBackendStatus` in
          // ProjectUpload is not called; we always fire onUploadComplete with the uploadJobId.
          // The parent page polling will then advance from PARSED to the real status when ready.
          clearInterval(interval);
          if (onUploadComplete) {
            onUploadComplete(id);
          }
        } else if (data.status === 'failed') {
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Polling failed', err);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [accessToken, onUploadComplete]);

  useEffect(() => {
    if (initialJobId) {
      pollStatus(initialJobId);
    }
  }, [initialJobId, pollStatus]);

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/languages`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => setLanguages(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [accessToken]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFile(acceptedFiles[0]);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false
  });

  const handleUpload = async () => {
    if (!file || !accessToken) return;

    setUploading(true);
    setProgress(10);
    setError(null);

    try {
      // 1. Get pre-signed URL
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/projects/${projectId}/uploads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ filename: file.name, includeSeo, catalogContext: catalogContext.trim() || undefined, lang: selectedLang || undefined })
      });

      if (!res.ok) throw new Error('Failed to get upload URL');
      const { presignedUrl, uploadJobId } = await res.json();
      setJobId(uploadJobId);
      setProgress(30);

      // 2. Upload to S3
      const uploadRes = await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': 'text/csv' }
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => '');
        console.error('[Upload] S3 PUT failed:', uploadRes.status, errText, 'URL:', presignedUrl.substring(0, 100));
        throw new Error(`S3 upload failed: ${uploadRes.status}`);
      }
      setProgress(70);

      // 3. Notify backend that upload is complete and processing can start
      const startRes = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ includeSeo })
      });

      if (!startRes.ok) throw new Error('Failed to start enrichment process');

      setProgress(100);
      setStatus('parsing');
      pollStatus(uploadJobId);

    } catch (err: any) {
      setError(err.message);
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!jobId ? (
        <>
          <p className="text-sm text-muted-foreground mb-3">
            Upload your product catalog in CSV format. The system will automatically:
            1. Parse and validate the file structure;
            2. Analyze product categories using AI;
            3. Propose enrichment fields for your review.
          </p>
          <Card className={`border-2 border-dashed transition-colors ${isDragActive ? 'border-primary bg-primary/5' : 'border-zinc-200 dark:border-zinc-800'}`}>
            <div {...getRootProps()} className="p-12 cursor-pointer outline-none">
              <input {...getInputProps()} />
              <div className="flex flex-col items-center text-center">
                <Upload className="h-10 w-10 text-zinc-400 mb-4" />
                {file ? (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-emerald-500" />
                    <span className="font-medium">{file.name}</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium">Drag & drop CSV here, or click to select</p>
                    <p className="text-xs text-zinc-500 mt-1">Only .csv files up to 50MB</p>
                  </>
                )}
              </div>
            </div>
          </Card>
          
          {file && (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-1.5">
                <label htmlFor="catalogContext" className="text-sm font-medium">
                  Catalog description <span className="text-zinc-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="catalogContext"
                  rows={3}
                  value={catalogContext}
                  onChange={(e) => setCatalogContext(e.target.value)}
                  placeholder="Describe your product domain so AI generates more relevant fields and fills them more accurately. E.g. 'Children's toys and educational games, ages 0–12. Key attributes: age group, material safety, toy type, brand.'"
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none"
                />
                <p className="text-xs text-zinc-500">
                  Describe your products so AI generates more relevant fields. E.g.: &apos;Electronics and gadgets for home office&apos;, &apos;Organic cosmetics for women 25-45&apos;, &apos;Industrial spare parts for CNC machines&apos;.
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="language" className="text-sm font-medium">
                  Language <span className="text-zinc-400 font-normal">(optional)</span>
                </label>
                <Select value={selectedLang} onValueChange={setSelectedLang}>
                  <SelectTrigger id="language" className="w-full">
                    <SelectValue placeholder="Auto-detect" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Auto-detect</SelectItem>
                    {languages.map(l => (
                      <SelectItem key={l.code} value={l.code}>{l.nativeName} ({l.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-zinc-500">
                  Select the language of your catalog. Leave as Auto-detect to let AI determine it automatically.
                </p>
              </div>
              <div className="flex items-center gap-2 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <input
                  type="checkbox"
                  id="includeSeo"
                  checked={includeSeo}
                  onChange={(e) => setIncludeSeo(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 text-primary focus:ring-primary"
                />
                <label htmlFor="includeSeo" className="text-sm font-medium cursor-pointer select-none">
                  Auto-generate SEO attributes (Title, Description, Keywords)
                </label>
              </div>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-zinc-400" />
                <div>
                  <p className="text-sm font-medium">{file?.name}</p>
                  <p className="text-xs text-zinc-500">Status: <span className="uppercase text-primary font-bold">{status}</span></p>
                </div>
              </div>
              {status === 'parsed' || status === 'schema_draft' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : status === 'failed' ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
            </div>
            <Progress value={progress} className="h-2" />
          </CardContent>
        </Card>
      )}

      {file && !jobId && (
        <Button onClick={handleUpload} disabled={uploading} className="w-full">
          {uploading ? 'Uploading...' : 'Start Enrichment'}
        </Button>
      )}

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}
    </div>
  );
}

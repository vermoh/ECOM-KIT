"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { UploadJobStatus } from '@/types/csv';
import { Check } from 'lucide-react';
import { ProjectUpload } from '@/components/ProjectUpload';
import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';

import { ValidationSummary } from '@/components/csv-wizard/ValidationSummary';
import { SchemaReview } from '@/components/csv-wizard/SchemaReview';
import { EnrichmentMonitor } from '@/components/csv-wizard/EnrichmentMonitor';
import { CollisionReview } from '@/components/csv-wizard/CollisionReview';
import { ExportPanel } from '@/components/csv-wizard/ExportPanel';

const CSV_API = process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001';

const STAGES = [
  { id: 'upload', title: 'Upload', targetStatuses: ['PENDING'] },
  { id: 'validation', title: 'Validation', targetStatuses: ['PARSING', 'PARSED'] },
  { id: 'schema', title: 'Review Schema', targetStatuses: ['SCHEMA_DRAFT', 'SCHEMA_REVIEW', 'SCHEMA_CONFIRMED'] },
  { id: 'enrichment', title: 'Enrichment', targetStatuses: ['ENRICHING', 'ENRICHED'] },
  { id: 'collisions', title: 'Collisions', targetStatuses: ['NEEDS_COLLISION_REVIEW'] },
  { id: 'export', title: 'Export', targetStatuses: ['READY', 'EXPORTING', 'DONE'] },
];

// Ordered list of all wizard statuses from earliest to latest.
// Polling may only advance status forward, never roll it back.
const STATUS_ORDER: UploadJobStatus[] = [
  'PENDING', 'PARSING', 'PARSED',
  'SCHEMA_DRAFT', 'SCHEMA_REVIEW', 'SCHEMA_CONFIRMED',
  'ENRICHING', 'ENRICHED',
  'NEEDS_COLLISION_REVIEW',
  'READY', 'EXPORTING', 'DONE', 'FAILED'
];

// Statuses where the backend is actively doing work — keep polling
const ACTIVE_STATUSES: UploadJobStatus[] = ['PENDING', 'PARSING', 'SCHEMA_DRAFT', 'SCHEMA_REVIEW', 'ENRICHING', 'ENRICHED', 'EXPORTING'];

/**
 * Maps a raw backend DB status string to a UI wizard status.
 * Direct 1:1 mapping so page restores correctly after refresh.
 */
function mapBackendStatus(s: string): UploadJobStatus {
  switch (s) {
    case 'pending':                 return 'PENDING';
    case 'parsing':                 return 'PARSING';
    case 'parsed':                  return 'PARSED';
    case 'schema_draft':
    case 'schema_review':           return 'SCHEMA_DRAFT';
    case 'schema_confirmed':        return 'SCHEMA_CONFIRMED';
    case 'enriching':               return 'ENRICHING';
    case 'enriched':                return 'ENRICHED';
    case 'needs_collision_review':  return 'NEEDS_COLLISION_REVIEW';
    case 'ready':                   return 'READY';
    case 'exporting':               return 'EXPORTING';
    case 'done':                    return 'DONE';
    case 'failed':                  return 'FAILED';
    default:                        return 'PENDING';
  }
}

function getStageIndex(status: UploadJobStatus): number {
  const index = STAGES.findIndex(s => s.targetStatuses.includes(status));
  return index === -1 ? 0 : index;
}

export default function CSVWizardPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [status, setStatus] = useState<UploadJobStatus>('PENDING');
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);
  const [uploadJob, setUploadJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { accessToken } = useAuth();

  // When true, polling will not auto-advance past PARSED.
  // This keeps the user on ValidationSummary until they explicitly click "Generate Schema".
  const validationPause = React.useRef(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    async function loadProjectState() {
      if (!accessToken || !projectId) return;
      try {
        const res = await fetch(`${CSV_API}/projects/${projectId}/uploads`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (res.ok) {
          const uploads = await res.json();
          if (uploads && uploads.length > 0) {
            const latestJob = uploads[0]; // Ordered by createdAt desc server-side
            setUploadJobId(latestJob.id);
            setUploadJob(latestJob);
            const mapped = mapBackendStatus(latestJob.status);
            // Only advance the wizard status, never roll it back.
            // While validationPause is active, the user is reviewing the ValidationSummary —
            // don't auto-advance to SCHEMA_DRAFT until they click "Generate Schema".
            setStatus(prev => {
              if (validationPause.current && prev === 'PARSED') return prev;
              const prevIdx = STATUS_ORDER.indexOf(prev);
              const newIdx = STATUS_ORDER.indexOf(mapped);
              return newIdx > prevIdx ? mapped : prev;
            });
          }
        }
      } catch (err) {
        console.error('Failed to load project uploads', err);
      } finally {
        setLoading(false);
      }
    }

    loadProjectState();

    if (ACTIVE_STATUSES.includes(status)) {
      intervalId = setInterval(loadProjectState, 3000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [projectId, accessToken, status]);

  const currentStageIndex = getStageIndex(status);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">CSV Enrichment Wizard</h1>
        <p className="text-muted-foreground mt-1 font-mono text-xs text-zinc-400">project: {projectId}</p>
      </div>

      {/* Stepper Wizard Progress */}
      <div className="relative">
        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-zinc-200 dark:bg-zinc-800 -translate-y-1/2 z-0"></div>
        <div 
          className="absolute top-1/2 left-0 h-0.5 bg-primary -translate-y-1/2 z-0 transition-all duration-500 ease-in-out"
          style={{ width: `${(currentStageIndex / (STAGES.length - 1)) * 100}%` }}
        ></div>
        
        <div className="relative z-10 flex justify-between">
          {STAGES.map((stage, i) => {
            const isCompleted = i < currentStageIndex;
            const isCurrent = i === currentStageIndex;
            
            return (
              <div key={stage.id} className="flex flex-col items-center gap-2 bg-background px-2">
                <div 
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors duration-300 ${
                    isCompleted ? 'bg-primary text-primary-foreground' : 
                    isCurrent ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' : 
                    'bg-zinc-100 text-zinc-400 dark:bg-zinc-800'
                  }`}
                >
                  {isCompleted ? <Check className="w-5 h-5" /> : i + 1}
                </div>
                <span className={`text-xs font-medium ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {stage.title}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Stage Container */}
      <div className="bg-card border rounded-xl p-6 md:p-8 shadow-sm transition-all">
        {status === 'PENDING' && (
          <div className="space-y-4">
             <h2 className="text-xl font-semibold mb-6">Upload CSV File</h2>
             <ProjectUpload
               projectId={projectId}
               initialJobId={uploadJobId}
               onUploadComplete={(jobId) => {
                 setUploadJobId(jobId);
                 validationPause.current = true; // Hold on Validation until user clicks Continue
                 setStatus('PARSED');
               }}
             />
          </div>
        )}
        
        {['PARSING', 'PARSED'].includes(status) && (
          <ValidationSummary 
            filename={uploadJob?.originalFilename || 'document.csv'} 
            rowCount={uploadJob?.rowCount || 0} 
            onContinue={() => {
              validationPause.current = false; // Allow polling to advance
              setStatus('SCHEMA_DRAFT');
            }} 
          />
        )}

        {['SCHEMA_DRAFT', 'SCHEMA_REVIEW', 'SCHEMA_CONFIRMED'].includes(status) && (
          <SchemaReview 
            uploadJobId={uploadJobId!}
            onConfirmed={() => {
              setStatus('ENRICHING');
            }}
          />
        )}

        {['ENRICHING', 'ENRICHED'].includes(status) && (
          <EnrichmentMonitor 
            uploadJobId={uploadJobId!}
            onComplete={(nextStatus) => setStatus(nextStatus as UploadJobStatus)}
          />
        )}

        {status === 'NEEDS_COLLISION_REVIEW' && (
          <CollisionReview 
            projectId={projectId}
            uploadJobId={uploadJobId!}
            onResolvedAll={() => setStatus('READY')}
          />
        )}

        {['READY', 'EXPORTING', 'DONE'].includes(status) && (
          <ExportPanel 
            projectId={projectId}
            uploadJobId={uploadJobId!}
            status={status}
            onRunSeo={() => {}}
            onExport={() => setStatus('EXPORTING')}
            isExporting={status === 'EXPORTING'}
          />
        )}

        {status === 'FAILED' && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-950 mb-4">
              <span className="text-red-600 text-xl">✕</span>
            </div>
            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Processing Failed</h3>
            <p className="text-sm text-muted-foreground mb-6">
              {uploadJob?.errorDetails || 'An error occurred during processing. Please check the logs or try again.'}
            </p>
            <button
              onClick={() => setStatus('PENDING')}
              className="text-sm text-primary underline underline-offset-2"
            >
              ← Start over with a new file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

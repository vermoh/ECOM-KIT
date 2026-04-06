"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { CheckCircle, AlertTriangle, XCircle, Info, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface Collision {
  id: string;
  field: string;
  originalValue: string | null;
  reason: string;
  status: 'detected' | 'pending_review' | 'resolved' | 'dismissed';
  item: {
    id: string;
    skuExternalId: string;
    rawData: string;
    enrichedData: string;
  };
}

interface CollisionReviewProps {
  projectId: string;
  jobId: string;
  onComplete?: () => void;
}

export function CollisionReview({ projectId, jobId, onComplete }: CollisionReviewProps) {
  const { accessToken } = useAuth();
  const [collisions, setCollisions] = useState<Collision[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedValue, setResolvedValue] = useState('');

  useEffect(() => {
    fetchCollisions();
  }, [jobId]);

  const fetchCollisions = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/projects/${projectId}/jobs/${jobId}/collisions`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) throw new Error('Failed to fetch collisions');
      const data = await res.json();
      setCollisions(data || []);
      if (data.length > 0) {
        setResolvedValue(data[0].originalValue || '');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async () => {
    const current = collisions[currentIndex];
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/collisions/${current.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ resolvedValue })
      });
      if (!res.ok) throw new Error('Failed to resolve collision');
      
      const nextIndex = currentIndex + 1;
      if (nextIndex < collisions.length) {
        setCurrentIndex(nextIndex);
        setResolvedValue(collisions[nextIndex].originalValue || '');
      } else {
        if (onComplete) onComplete();
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDismiss = async () => {
    const current = collisions[currentIndex];
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/collisions/${current.id}/dismiss`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) throw new Error('Failed to dismiss collision');
      
      const nextIndex = currentIndex + 1;
      if (nextIndex < collisions.length) {
        setCurrentIndex(nextIndex);
        setResolvedValue(collisions[nextIndex].originalValue || '');
      } else {
        if (onComplete) onComplete();
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div className="p-12 text-center text-zinc-500">Loading collisions...</div>;
  if (collisions.length === 0) return (
    <div className="p-12 text-center text-emerald-600 flex flex-col items-center gap-4">
      <CheckCircle className="h-12 w-12" />
      <h3 className="text-xl font-bold">All collisions resolved!</h3>
      <Button onClick={onComplete}>Back to Project</Button>
    </div>
  );

  const current = collisions[currentIndex];
  const rawData = JSON.parse(current.item.rawData || '{}');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="px-2 py-1 bg-amber-50 text-amber-700 border-amber-200 gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Collision {currentIndex + 1} of {collisions.length}
          </Badge>
          <span className="text-sm text-zinc-500">SKU: <span className="font-mono text-zinc-900">{current.item.skuExternalId}</span></span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDismiss} className="gap-2 text-zinc-500 hover:text-red-600">
            <XCircle className="h-4 w-4" /> Dismiss
          </Button>
          <Button size="sm" onClick={handleResolve} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <CheckCircle className="h-4 w-4" /> Resolve & Next
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Raw Data Section */}
        <Card className="border-zinc-200">
          <CardHeader className="bg-zinc-50/50 py-3 px-4">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Info className="h-4 w-4 text-zinc-400" /> Raw CSV Data
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 overflow-auto max-h-[400px]">
            <table className="w-full text-xs">
              <tbody>
                {Object.entries(rawData).map(([k, v]: [string, any]) => (
                  <tr key={k} className="border-b border-zinc-50 last:border-0">
                    <td className="py-2 pr-4 font-bold text-zinc-500 align-top">{k}</td>
                    <td className="py-2 text-zinc-900 align-top break-all">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Resolution Section */}
        <div className="space-y-6">
          <Card className="border-amber-200 bg-amber-50/10">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Resolution: <span className="text-primary">{current.field}</span>
              </CardTitle>
              <CardDescription className="text-[10px] uppercase font-bold tracking-widest text-amber-600">
                Reason: {current.reason.replace('_', ' ')}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">AI Suggestion</label>
                <div className="p-3 bg-white border border-zinc-200 rounded-lg text-sm italic text-zinc-500">
                  {current.originalValue || <span className="text-zinc-300">No value suggested</span>}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Your Correction</label>
                <textarea 
                  className="w-full bg-white border-2 border-primary/20 rounded-xl px-4 py-3 text-sm min-h-[120px] focus:ring-4 focus:ring-primary/10 outline-none placeholder:text-zinc-300"
                  placeholder="Type the correct value here..."
                  value={resolvedValue}
                  onChange={(e) => setResolvedValue(e.target.value)}
                />
              </div>

              <div className="p-3 bg-zinc-900 rounded-lg text-xs text-white flex items-start gap-3">
                <div className="mt-0.5"><Info className="h-4 w-4 text-amber-400" /></div>
                <p>Resolution will override the AI-generated value for this specific field. This action is recorded in the audit log.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

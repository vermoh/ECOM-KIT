"use client";

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowRight, CheckCircle2, Clock } from 'lucide-react';

interface ReviewTaskProps {
  task: {
    id: string;
    taskType: 'schema_review' | 'collision_review' | 'seo_review';
    status: 'pending' | 'in_progress' | 'completed' | 'skipped';
    createdAt: string;
  };
  onAction: (taskId: string) => void;
}

export function ReviewTaskCard({ task, onAction }: ReviewTaskProps) {
  const getTaskTitle = () => {
    switch (task.taskType) {
      case 'schema_review': return 'Schema Review Required';
      case 'collision_review': return 'Collision Resolution Required';
      case 'seo_review': return 'SEO Review Required';
      default: return 'Review Task';
    }
  };

  const isCompleted = task.status === 'completed';

  return (
    <Card className={`border-l-4 ${isCompleted ? 'border-l-emerald-500' : 'border-l-amber-500'}`}>
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-full ${isCompleted ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
            {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          </div>
          <div>
            <h4 className="text-sm font-bold text-zinc-900">{getTaskTitle()}</h4>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500 uppercase tracking-wider">
              <Clock className="h-3 w-3" />
              <span>{new Date(task.createdAt).toLocaleDateString()}</span>
              <span>•</span>
              <span className={isCompleted ? 'text-emerald-600' : 'text-amber-600'}>{task.status}</span>
            </div>
          </div>
        </div>
        {!isCompleted && (
          <Button size="sm" onClick={() => onAction(task.id)} className="gap-2">
            Start Review
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, CheckCircle2, AlertCircle, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/utils';
import { useTranslations } from 'next-intl';

interface ValidationSummaryProps {
  filename: string;
  rowCount: number;
  onContinue: () => void;
}

export function ValidationSummary({ filename, rowCount, onContinue }: ValidationSummaryProps) {
  const t = useTranslations('csvWizard.validation');
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/50">
          <CardContent className="p-4 flex items-start gap-4">
            <div className="bg-emerald-100 dark:bg-emerald-900/50 p-2 rounded-full">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">{t('formatValid')}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{t('csvParsedSuccessfully')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex flex-col justify-center h-full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">{t('file')}</span>
              </div>
              <span className="text-sm font-semibold">{filename}</span>
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">{t('rows')}</span>
              </div>
              <span className="text-sm font-semibold">{formatNumber(rowCount)} {t('skus')}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg flex gap-3 border border-blue-100 dark:border-blue-900/50">
        <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">{t('nextStep')}</p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            {t('aiAnalyzeData')}
          </p>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={onContinue} size="lg">
          {t('generateSchema')}
        </Button>
      </div>
    </div>
  );
}

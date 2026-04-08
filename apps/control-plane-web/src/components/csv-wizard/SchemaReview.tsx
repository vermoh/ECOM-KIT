"use client";

import React, { useState } from 'react';
import { SchemaTemplate, SchemaField } from '@/types/csv';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { Textarea } from '@/components/ui/textarea';
import { Check, ChevronDown, ChevronRight, Edit2, Eye, Globe, Info, Languages, Lightbulb, Plus, ShieldAlert, Trash2 } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface SchemaReviewProps {
  uploadJobId: string;
  onConfirmed: () => void;
}

export function SchemaReview({ uploadJobId, onConfirmed }: SchemaReviewProps) {
  const { accessToken } = useAuth();
  const t = useTranslations('csvWizard.schemaReview');
  const [schema, setSchema] = useState<SchemaTemplate | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [goldenSamples, setGoldenSamples] = useState('');
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [languages, setLanguages] = useState<{id: string, code: string, name: string, nativeName: string}[]>([]);
  const [currentLang, setCurrentLang] = useState<string>('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewResults, setPreviewResults] = useState<any[] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  React.useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let cancelled = false;
    let delay = 2000; // start at 2s

    async function loadSchema() {
      if (!uploadJobId || !accessToken) return;
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}/schema`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (res.ok) {
          const data = await res.json();
          const mappedSchema: SchemaTemplate = {
            id: data.id,
            version: data.version,
            status: data.status,
            fields: data.fields.map((f: any) => ({
              id: f.id,
              name: f.name,
              label: f.label || f.name,
              type: f.fieldType,
              required: f.isRequired,
              isFilterable: f.isFilterable ?? false,
              allowedValues: f.allowedValues || [],
              description: f.description || '',
              extractionHint: f.extractionHint || '',
              unit: f.unit || null,
              confidence: f.confidence ?? null,
              rationale: f.rationale || null,
            }))
          };
          setSchema(mappedSchema);
          setIsLoading(false);
          // Loaded successfully — stop polling, reset delay
          delay = 2000;
          return;
        } else if (res.status === 404) {
          // Schema doesn't exist yet, keep polling
          setIsLoading(true);
        }
      } catch (err) {
        console.error('Failed to load schema:', err);
      }

      // Schedule next poll with exponential backoff (1.5x, cap 15s)
      if (!cancelled) {
        timeoutId = setTimeout(loadSchema, delay);
        delay = Math.min(delay * 1.5, 15000);
      }
    }

    // Initial load
    loadSchema();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [uploadJobId, accessToken]);

  // Fetch languages list
  React.useEffect(() => {
    if (!accessToken) return;
    fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/languages`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => setLanguages(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [accessToken]);

  // Fetch upload job to get detected language
  React.useEffect(() => {
    if (!uploadJobId || !accessToken) return;
    fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.lang) setCurrentLang(data.lang);
      })
      .catch(() => {});
  }, [uploadJobId, accessToken]);

  const handleTranslate = async () => {
    if (!currentLang || !accessToken) return;
    setIsTranslating(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}/schema/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ targetLang: currentLang })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.fields && Array.isArray(data.fields)) {
          setSchema(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              fields: prev.fields.map(f => {
                const translated = data.fields.find((tf: any) => tf.name === f.name);
                if (translated) {
                  return {
                    ...f,
                    label: translated.label ?? f.label,
                    description: translated.description ?? f.description
                  };
                }
                return f;
              })
            };
          });
        }
        // PATCH the upload job's lang
        await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ lang: currentLang })
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Translation failed:', err);
    } finally {
      setIsTranslating(false);
    }
  };

  const handlePreview = async () => {
    if (!accessToken || isPreviewing) return;
    setIsPreviewing(true);
    setPreviewResults(null);
    setPreviewError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}/enrichment/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ sampleCount: 5 })
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewResults(data.items || []);
        setPreviewOpen(true);
      } else {
        const err = await res.json().catch(() => ({}));
        setPreviewError(err.message || err.error || `Preview failed (${res.status})`);
        console.error('Preview failed:', err);
      }
    } catch (err: any) {
      setPreviewError(err.message || 'Preview request failed');
      console.error('Preview request failed:', err);
    } finally {
      setIsPreviewing(false);
    }
  };

  const updateField = (fieldId: string, updates: Partial<SchemaField>) => {
    setSchema(prev => prev ? ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, ...updates } : f)
    }) : null);
  };

  const removeField = (fieldId: string) => {
    setSchema(prev => {
      if (!prev || prev.fields.length <= 1) return prev;
      return { ...prev, fields: prev.fields.filter(f => f.id !== fieldId) };
    });
    if (editingField === fieldId) setEditingField(null);
  };

  const addField = () => {
    const newId = `custom-${Date.now()}`;
    setSchema(prev => prev ? ({
      ...prev,
      fields: [...prev.fields, {
        id: newId,
        name: '',
        label: '',
        type: 'text' as any,
        required: true,
        isFilterable: false,
        allowedValues: [],
        description: '',
        extractionHint: '',
        unit: null,
        confidence: null,
        rationale: null,
      }]
    }) : null);
    setEditingField(newId);
  };

  const handleApprove = async () => {
    if (!schema || !accessToken) return;
    setIsApproving(true);
    setApproveError(null);
    try {
      // 1. If we edited the schema locally, we should probably PATCH it first.
      // For now we assume we just send the approval. The edit support uses the PATCH if we implement it.
      // But let's just do a simple patch + approve for completeness:
      const patchRes = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}/schema`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          fields: schema.fields.map(f => ({
            name: f.name,
            label: f.label || f.name,
            fieldType: f.type,
            isRequired: f.required,
            isFilterable: f.isFilterable ?? false,
            allowedValues: f.allowedValues,
            description: f.description,
            extractionHint: f.extractionHint || undefined,
            unit: f.unit || undefined,
            confidence: f.confidence ?? undefined,
            rationale: f.rationale || undefined,
          })),
          goldenSamples: goldenSamples.trim() ? goldenSamples.trim() : undefined
        })
      });
      if (!patchRes.ok) {
        const errBody = await patchRes.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to patch schema (${patchRes.status})`);
      }

      // 2. Approve it
      const approveRes = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}/schema/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!approveRes.ok) throw new Error('Failed to approve schema');

      // 3. Start enrichment automatically after approval
      const startEnrichRes = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${uploadJobId}/enrichment/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!startEnrichRes.ok) {
        const errBody = await startEnrichRes.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to start enrichment (${startEnrichRes.status})`);
      }

      onConfirmed();
    } catch (err: any) {
      console.error('Failed to confirm schema:', err);
      setApproveError(err.message || 'Failed to confirm schema. Check API logs.');
    } finally {
      setIsApproving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground border rounded-lg bg-zinc-50 dark:bg-zinc-900 border-dashed">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-1">{t('aiSchemaGenerationInProgress')}</h3>
        <p className="text-sm">{t('analyzingCSVHeaders')}</p>
        <p className="text-xs mt-4">{t('pleasWait')}</p>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="text-center p-12 text-muted-foreground border rounded-lg bg-zinc-50 dark:bg-zinc-900 border-dashed">
        <ShieldAlert className="w-10 h-10 mx-auto mb-4 text-red-400" />
        <p className="font-semibold text-lg text-red-500">{t('schemaGenerationFailed')}</p>
        <p className="text-sm mt-2">{t('checkAiProvider')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">{t('title')}</h2>
          <Badge variant="outline" className="bg-amber-50 text-琥珀-700 border-琥珀-200">
            {t('version')} {schema.version}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {t('subtitle')}
        </p>
      </div>

      <div className="flex gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-300">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p>{t('aiProposedEnrichment')}</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            <li>{t('toggleFields')}</li>
            <li>{t('deleteAddFields')}</li>
            <li>{t('editFieldNames')}</li>
            <li>{t('provideReferences')}</li>
          </ul>
          <p className="text-xs">{t('enrichmentBeginsAutomatically')}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('language')}</span>
        <Select value={currentLang} onValueChange={(v) => setCurrentLang(v ?? '')}>
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue placeholder="Auto-detected" />
          </SelectTrigger>
          <SelectContent>
            {languages.map(l => (
              <SelectItem key={l.code} value={l.code}>{l.nativeName} ({l.code})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleTranslate} disabled={isTranslating || !currentLang}>
          {isTranslating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Languages className="h-4 w-4 mr-1" />}
          {t('translateLabels')}
        </Button>
      </div>

      <div className="space-y-2">
        {schema.fields.map(field => {
          const isEditing = editingField === field.id;

          return (
            <Card key={field.id} className={isEditing ? 'border-primary/40 bg-muted/30' : ''}>
              <CardContent className="p-3">
                {isEditing ? (
                  /* ── Edit mode ── */
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">{t('label')}</label>
                        <Input
                          value={(field as any).label || field.name}
                          onChange={(e) => updateField(field.id, { label: e.target.value } as any)}
                          placeholder={t('humanReadableLabel')}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">{t('key')}</label>
                        <Input
                          value={field.name}
                          onChange={(e) => updateField(field.id, { name: e.target.value })}
                          placeholder={t('snakeCaseKey')}
                          className="h-8 text-sm font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">{t('type')}</label>
                        <Select
                          value={field.type}
                          onValueChange={(val: any) => updateField(field.id, { type: val })}
                        >
                          <SelectTrigger className="h-8 w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">{t('text')}</SelectItem>
                            <SelectItem value="number">{t('number')}</SelectItem>
                            <SelectItem value="boolean">{t('boolean')}</SelectItem>
                            <SelectItem value="enum">{t('enum')}</SelectItem>
                            <SelectItem value="url">{t('url')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">{t('unit')}</label>
                        <Input
                          value={field.unit || ''}
                          onChange={(e) => updateField(field.id, { unit: e.target.value || null })}
                          placeholder="kg, cm, ml..."
                          className="h-8 text-sm w-[100px]"
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-4">
                        <Switch
                          checked={field.required}
                          onCheckedChange={(checked) => updateField(field.id, { required: checked })}
                        />
                        <span className="text-xs text-muted-foreground">{t('required')}</span>
                      </div>
                      <div className="flex items-center gap-2 pt-4">
                        <Switch
                          checked={field.isFilterable}
                          onCheckedChange={(checked) => updateField(field.id, { isFilterable: checked })}
                        />
                        <span className="text-xs text-muted-foreground">{t('filterable')}</span>
                      </div>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingField(null)}
                        className="mt-3"
                      >
                        <Check className="h-4 w-4 text-emerald-500 mr-1" /> {t('done')}
                      </Button>
                    </div>
                    {field.description && (
                      <p className="text-xs text-muted-foreground italic">{field.description}</p>
                    )}
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">
                        {t('extractionHint')} <span className="normal-case font-normal">{t('extractionHintOptional')}</span>
                      </label>
                      <Textarea
                        value={field.extractionHint || ''}
                        onChange={(e) => updateField(field.id, { extractionHint: e.target.value })}
                        placeholder={t('extractionHintExample')}
                        className="text-sm min-h-[60px] resize-y"
                        rows={2}
                      />
                    </div>
                  </div>
                ) : (
                  /* ── View mode ── */
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={field.required}
                      onCheckedChange={(checked) => updateField(field.id, { required: checked })}
                      className="shrink-0"
                    />
                    <div className={`flex-1 min-w-0 ${!field.required ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{field.label || field.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{field.name}</span>
                        {field.unit && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{field.unit}</Badge>
                        )}
                        {field.isFilterable && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800">{t('filterable')}</Badge>
                        )}
                      </div>
                      {field.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{field.description}</p>
                      )}
                      {field.rationale && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 truncate">{field.rationale}</p>
                      )}
                      {field.extractionHint && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1 truncate">
                          <Lightbulb className="h-3 w-3 shrink-0" />
                          {field.extractionHint}
                        </p>
                      )}
                    </div>
                    {field.confidence != null && (
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] px-1.5 py-0 font-medium ${
                          field.confidence >= 85 ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800' :
                          field.confidence >= 65 ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800' :
                          'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800'
                        }`}
                      >
                        {field.confidence}%
                      </Badge>
                    )}
                    <Badge variant="secondary" className="font-normal capitalize shrink-0">{field.type}</Badge>
                    {field.type === 'enum' && field.allowedValues.length > 0 && (
                      <div className="flex flex-wrap gap-1 shrink-0 max-w-[200px]">
                        {field.allowedValues.slice(0, 3).map(v => (
                          <Badge key={v} variant="outline" className="text-[10px] px-1.5 py-0">{v}</Badge>
                        ))}
                        {field.allowedValues.length > 3 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">+{field.allowedValues.length - 3}</Badge>
                        )}
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingField(field.id)}
                      className="shrink-0"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeField(field.id)}
                      disabled={schema.fields.length <= 1}
                      className="shrink-0 text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button variant="outline" onClick={addField} className="w-full border-dashed">
        <Plus className="h-4 w-4 mr-2" /> {t('addCustomField')}
      </Button>

      <div className="border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setSamplesOpen(!samplesOpen)}
          className="w-full flex items-center gap-2 p-3 text-sm font-medium hover:bg-muted/50 transition-colors text-left"
        >
          {samplesOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {t('referenceExamples')}
        </button>
        {samplesOpen && (
          <div className="px-3 pb-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('provideCorrectlyFilled')}
            </p>
            <Textarea
              value={goldenSamples}
              onChange={(e) => setGoldenSamples(e.target.value)}
              placeholder={t('referenceExamplesPlaceholder')}
              className="font-mono text-xs min-h-[100px] resize-y"
              rows={5}
            />
          </div>
        )}
      </div>

      {/* Preview Section */}
      <div className="border rounded-lg overflow-hidden">
        <div className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('previewTitle')}</span>
            <span className="text-xs text-muted-foreground">{t('previewDescription')}</span>
          </div>
          <Button variant="outline" size="sm" onClick={handlePreview} disabled={isPreviewing}>
            {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {isPreviewing ? t('previewing') : t('previewButton')}
          </Button>
        </div>
        {previewError && (
          <div className="border-t px-3 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30">
            {previewError}
          </div>
        )}
        {previewOpen && previewResults && previewResults.length > 0 && (
          <div className="border-t px-3 pb-3 space-y-2 max-h-[400px] overflow-y-auto">
            {previewResults.map((item: any, idx: number) => (
              <div key={idx} className="bg-muted/30 rounded-md p-3 space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium">Item {idx + 1}</span>
                  {item.confidence != null && (
                    <Badge variant="outline" className={`text-[10px] ${
                      item.confidence >= 85 ? 'text-emerald-600 border-emerald-200' :
                      item.confidence >= 65 ? 'text-amber-600 border-amber-200' :
                      'text-red-600 border-red-200'
                    }`}>
                      {item.confidence}%
                    </Badge>
                  )}
                  {item.error && (
                    <Badge variant="outline" className="text-[10px] text-red-600 border-red-200">Error</Badge>
                  )}
                </div>
                {item.enrichedData && Object.entries(item.enrichedData).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground w-[140px] shrink-0 truncate">{key}</span>
                    <span className="text-foreground">{String(val)}</span>
                    {item.fieldConfidence?.[key] != null && (
                      <span className={`text-[10px] ml-auto ${
                        item.fieldConfidence[key] >= 85 ? 'text-emerald-500' :
                        item.fieldConfidence[key] >= 65 ? 'text-amber-500' : 'text-red-500'
                      }`}>
                        {item.fieldConfidence[key]}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-zinc-50 dark:bg-zinc-900 border rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          <p className="text-sm font-medium">{t('requiresReviewerRole')}</p>
        </div>

        <PermissionGate permission="schema:approve">
          <Button onClick={handleApprove} disabled={isApproving}>
            {isApproving ? t('confirming') : t('confirmSchemaStart')}
          </Button>
        </PermissionGate>
      </div>

      {approveError && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-600 dark:text-red-400">
          <strong>Error:</strong> {approveError}
        </div>
      )}
    </div>
  );
}

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
import { Check, ChevronDown, ChevronRight, Edit2, Info, Lightbulb, Plus, ShieldAlert, Trash2 } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';

interface SchemaReviewProps {
  uploadJobId: string;
  onConfirmed: () => void;
}

export function SchemaReview({ uploadJobId, onConfirmed }: SchemaReviewProps) {
  const { accessToken } = useAuth();
  const [schema, setSchema] = useState<SchemaTemplate | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [goldenSamples, setGoldenSamples] = useState('');
  const [samplesOpen, setSamplesOpen] = useState(false);

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
              allowedValues: f.allowedValues || [],
              description: f.description || '',
              extractionHint: f.extractionHint || ''
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
        allowedValues: [],
        description: '',
        extractionHint: ''
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
            label: (f as any).label || f.name,
            fieldType: f.type,
            isRequired: f.required,
            allowedValues: f.allowedValues,
            description: f.description,
            extractionHint: f.extractionHint || undefined
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
        <h3 className="text-lg font-medium text-foreground mb-1">AI Schema Generation in progress</h3>
        <p className="text-sm">We are analyzing your CSV headers and creating a strict schema template via AI...</p>
        <p className="text-xs mt-4">Please wait, this usually takes 10-15 seconds.</p>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="text-center p-12 text-muted-foreground border rounded-lg bg-zinc-50 dark:bg-zinc-900 border-dashed">
        <ShieldAlert className="w-10 h-10 mx-auto mb-4 text-red-400" />
        <p className="font-semibold text-lg text-red-500">Schema generation failed</p>
        <p className="text-sm mt-2">Please check your AI Provider setting keys or try again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Review Target Schema</h2>
          <Badge variant="outline" className="bg-amber-50 text-琥珀-700 border-琥珀-200">
            Version {schema.version}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          AI has analyzed your data and proposed the following extraction schema.
          Please review and adjust types before confirming.
        </p>
      </div>

      <div className="flex gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-300">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p>AI has proposed enrichment fields based on your catalog. You can:</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            <li>Toggle fields on/off — only enabled fields will be enriched</li>
            <li>Delete unwanted fields or add your own custom fields</li>
            <li>Edit field names, types, and add extraction hints</li>
            <li>Provide reference examples at the bottom for best results</li>
          </ul>
          <p className="text-xs">Once confirmed, enrichment will begin automatically for enabled fields only.</p>
        </div>
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
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Label</label>
                        <Input
                          value={(field as any).label || field.name}
                          onChange={(e) => updateField(field.id, { label: e.target.value } as any)}
                          placeholder="Human Readable Label"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Key</label>
                        <Input
                          value={field.name}
                          onChange={(e) => updateField(field.id, { name: e.target.value })}
                          placeholder="snake_case_key"
                          className="h-8 text-sm font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Type</label>
                        <Select
                          value={field.type}
                          onValueChange={(val: any) => updateField(field.id, { type: val })}
                        >
                          <SelectTrigger className="h-8 w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="boolean">Boolean</SelectItem>
                            <SelectItem value="enum">Enum</SelectItem>
                            <SelectItem value="url">URL</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2 pt-4">
                        <Switch
                          checked={field.required}
                          onCheckedChange={(checked) => updateField(field.id, { required: checked })}
                        />
                        <span className="text-xs text-muted-foreground">Required</span>
                      </div>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingField(null)}
                        className="mt-3"
                      >
                        <Check className="h-4 w-4 text-emerald-500 mr-1" /> Done
                      </Button>
                    </div>
                    {field.description && (
                      <p className="text-xs text-muted-foreground italic">{field.description}</p>
                    )}
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">
                        AI Extraction Hint <span className="normal-case font-normal">(optional)</span>
                      </label>
                      <Textarea
                        value={field.extractionHint || ''}
                        onChange={(e) => updateField(field.id, { extractionHint: e.target.value })}
                        placeholder="E.g.: Extract from beginning of product name. Always capitalize. Look for patterns like '60ml'..."
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
                        <span className="font-medium text-sm">{(field as any).label || field.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{field.name}</span>
                      </div>
                      {field.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{field.description}</p>
                      )}
                      {field.extractionHint && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1 truncate">
                          <Lightbulb className="h-3 w-3 shrink-0" />
                          {field.extractionHint}
                        </p>
                      )}
                    </div>
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
        <Plus className="h-4 w-4 mr-2" /> Add Custom Field
      </Button>

      <div className="border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setSamplesOpen(!samplesOpen)}
          className="w-full flex items-center gap-2 p-3 text-sm font-medium hover:bg-muted/50 transition-colors text-left"
        >
          {samplesOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Reference Examples
        </button>
        {samplesOpen && (
          <div className="px-3 pb-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Provide 1-3 correctly filled product examples so the AI knows exactly what you expect.
              Each row should have the schema field names as keys.
            </p>
            <Textarea
              value={goldenSamples}
              onChange={(e) => setGoldenSamples(e.target.value)}
              placeholder={`[\n  { "brand": "Neutrogena", "volume": "60ml", "category": "Skincare" },\n  { "brand": "CeraVe", "volume": "250ml", "category": "Cleanser" }\n]`}
              className="font-mono text-xs min-h-[100px] resize-y"
              rows={5}
            />
          </div>
        )}
      </div>

      <div className="bg-zinc-50 dark:bg-zinc-900 border rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          <p className="text-sm font-medium">Schema confirmation requires Reviewer role</p>
        </div>
        
        <PermissionGate permission="schema:approve">
          <Button onClick={handleApprove} disabled={isApproving}>
            {isApproving ? 'Confirming...' : 'Confirm Schema & Start'}
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

"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { Save, CheckCircle, AlertTriangle, Plus, Trash2, GripVertical } from 'lucide-react';

interface Field {
  id?: string;
  name: string;
  label: string;
  fieldType: 'text' | 'number' | 'boolean' | 'enum' | 'url';
  isRequired: boolean;
  allowedValues?: string[];
  description?: string;
  sortOrder: number;
}

interface SchemaEditorProps {
  jobId: string;
  onApprove?: () => void;
  onCancel?: () => void;
}

export function SchemaEditor({ jobId, onApprove, onCancel }: SchemaEditorProps) {
  const { accessToken } = useAuth();
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFields();
  }, [jobId]);

  const fetchFields = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${jobId}/schema`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) throw new Error('Failed to fetch schema');
      const data = await res.json();
      setFields(data.fields || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddField = () => {
    const newField: Field = {
      name: `field_${fields.length + 1}`,
      label: 'New Field',
      fieldType: 'text',
      isRequired: false,
      sortOrder: fields.length
    };
    setFields([...fields, newField]);
  };

  const handleUpdateField = (index: number, updates: Partial<Field>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    setFields(newFields);
  };

  const handleRemoveField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const handleSave = async (approve = false) => {
    setSaving(true);
    setError(null);
    try {
      // 1. Save changes
      const saveRes = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${jobId}/schema`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ fields })
      });
      if (!saveRes.ok) throw new Error('Failed to save schema');

      // 2. Approve if requested
      if (approve) {
        const approveRes = await fetch(`${process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001'}/uploads/${jobId}/schema/approve`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!approveRes.ok) throw new Error('Failed to approve schema');
        if (onApprove) onApprove();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-12 text-center text-zinc-500">Loading schema...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Schema Editor</CardTitle>
            <CardDescription>AI suggests these characteristics based on your CSV. Refine them before proceeding.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button variant="outline" onClick={() => handleSave(false)} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" /> Save Draft
            </Button>
            <Button onClick={() => handleSave(true)} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <CheckCircle className="h-4 w-4" /> Approve Schema
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg flex items-center gap-2 text-sm italic">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-zinc-50 dark:bg-zinc-900 rounded-lg text-xs font-bold uppercase text-zinc-500 tracking-wider">
              <div className="col-span-1"></div>
              <div className="col-span-3">Machine Name</div>
              <div className="col-span-3">Display Label</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-1 text-center">Required</div>
              <div className="col-span-2"></div>
            </div>

            {fields.map((field, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-4 items-center p-4 border border-zinc-100 dark:border-zinc-800 rounded-xl hover:shadow-md transition-shadow">
                <div className="col-span-1 text-zinc-300">
                  <GripVertical className="h-5 w-5 cursor-grab" />
                </div>
                
                <div className="col-span-3">
                  <input 
                    className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-sm font-mono focus:ring-2 focus:ring-primary/20 outline-none"
                    value={field.name}
                    onChange={(e) => handleUpdateField(idx, { name: e.target.value })}
                  />
                </div>

                <div className="col-span-3">
                  <input 
                    className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    value={field.label}
                    onChange={(e) => handleUpdateField(idx, { label: e.target.value })}
                  />
                </div>

                <div className="col-span-2">
                  <select 
                    className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none capitalize"
                    value={field.fieldType}
                    onChange={(e) => handleUpdateField(idx, { fieldType: e.target.value as any })}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="enum">Enum/Select</option>
                    <option value="url">URL</option>
                  </select>
                </div>

                <div className="col-span-1 flex justify-center">
                  <input 
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-primary focus:ring-primary"
                    checked={field.isRequired}
                    onChange={(e) => handleUpdateField(idx, { isRequired: e.target.checked })}
                  />
                </div>

                <div className="col-span-2 flex justify-end gap-2">
                  <Button variant="outline" size="sm" className="text-red-500 hover:bg-red-50 hover:text-red-600 border-red-100 h-8 w-8 p-0" onClick={() => handleRemoveField(idx)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="col-span-11 col-start-2 mt-2">
                  <textarea 
                    placeholder="Provide context for AI enrichment..."
                    className="w-full bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-500 italic focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                    value={field.description || ''}
                    rows={1}
                    onChange={(e) => handleUpdateField(idx, { description: e.target.value })}
                  />
                </div>
              </div>
            ))}

            <Button variant="outline" onClick={handleAddField} className="w-full border-dashed gap-2 text-zinc-500 hover:text-zinc-900">
              <Plus className="h-4 w-4" /> Add Characteristic
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

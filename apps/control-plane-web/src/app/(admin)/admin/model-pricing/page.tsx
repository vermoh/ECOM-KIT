"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface ModelPricing {
  id: string;
  model: string;
  provider: string;
  displayName: string;
  inputCostPer1m: number;
  outputCostPer1m: number;
  active: boolean;
}

const emptyForm = {
  model: '',
  provider: 'openrouter',
  displayName: '',
  inputCostPer1m: '',
  outputCostPer1m: '',
};

export default function ModelPricingPage() {
  const { accessToken } = useAuth();
  const [data, setData] = useState<ModelPricing[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete confirmation state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchPricing = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/model-pricing`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const raw = await res.json();
        const list: ModelPricing[] = Array.isArray(raw) ? raw : (raw.data ?? raw.models ?? []);
        setData(list);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchPricing();
  }, [fetchPricing]);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (row: ModelPricing) => {
    setEditingId(row.id);
    setForm({
      model: row.model,
      provider: row.provider,
      displayName: row.displayName,
      inputCostPer1m: String(row.inputCostPer1m),
      outputCostPer1m: String(row.outputCostPer1m),
    });
    setFormError('');
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!form.model.trim() || !form.provider.trim()) {
      setFormError('Model and Provider are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        model: form.model.trim(),
        provider: form.provider.trim(),
        displayName: form.displayName.trim(),
        inputCostPer1m: Number(form.inputCostPer1m),
        outputCostPer1m: Number(form.outputCostPer1m),
      };
      const url = editingId
        ? `${API}/api/v1/admin/model-pricing/${editingId}`
        : `${API}/api/v1/admin/model-pricing`;
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setDialogOpen(false);
        await fetchPricing();
      } else {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || err.message || `Error ${res.status}`);
      }
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (id: string) => {
    setDeleteId(id);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/model-pricing/${deleteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        setDeleteDialogOpen(false);
        setDeleteId(null);
        await fetchPricing();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Model Pricing</h1>
          <p className="text-muted-foreground mt-2">
            Configure AI model costs used for usage billing calculations.
          </p>
        </div>
        <Button onClick={openAdd} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Model
        </Button>
      </div>

      {/* Pre-seed suggestion */}
      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
        <CardContent className="pt-4">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <span className="font-semibold">Common OpenRouter models:</span>{' '}
            openai/gpt-4o ($2.50/$10.00), openai/gpt-4o-mini ($0.15/$0.60), anthropic/claude-sonnet-4 ($3.00/$15.00)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configured Models</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
            </div>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10 italic">
              No model pricing configured yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead className="text-right">Input $/1M</TableHead>
                  <TableHead className="text-right">Output $/1M</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.model}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.provider}</TableCell>
                    <TableCell className="text-sm">{row.displayName || '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${Number(row.inputCostPer1m).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${Number(row.outputCostPer1m).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.active ? 'default' : 'secondary'}>
                        {row.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(row)}
                          className="h-8 w-8 p-0"
                        >
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => confirmDelete(row.id)}
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Model Pricing' : 'Add Model Pricing'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Update the pricing configuration for this model.'
                : 'Add a new AI model with its cost per 1M tokens.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                placeholder="e.g. openai/gpt-4o"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Input
                id="provider"
                placeholder="e.g. openrouter"
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                placeholder="e.g. GPT-4o"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="inputCostPer1m">Input $/1M tokens</Label>
                <Input
                  id="inputCostPer1m"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 2.50"
                  value={form.inputCostPer1m}
                  onChange={(e) => setForm((f) => ({ ...f, inputCostPer1m: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="outputCostPer1m">Output $/1M tokens</Label>
                <Input
                  id="outputCostPer1m"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 10.00"
                  value={form.outputCostPer1m}
                  onChange={(e) => setForm((f) => ({ ...f, outputCostPer1m: e.target.value }))}
                />
              </div>
            </div>
            {formError && (
              <p className="text-sm text-red-500">{formError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingId ? 'Save Changes' : 'Add Model'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Model Pricing</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this model pricing entry? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

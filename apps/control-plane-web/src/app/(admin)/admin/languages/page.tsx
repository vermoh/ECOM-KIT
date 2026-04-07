"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/context/AuthContext';
import { Globe, Plus, Trash2, Download, Upload, Edit2, Check, X, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Language {
  id: string;
  code: string;
  name: string;
  nativeName: string;
  isActive: boolean;
}

interface AddForm {
  code: string;
  name: string;
  nativeName: string;
}

interface EditForm {
  code: string;
  name: string;
  nativeName: string;
}

const defaultAddForm: AddForm = { code: '', name: '', nativeName: '' };

export default function AdminLanguagesPage() {
  const { accessToken } = useAuth();
  const t = useTranslations('admin.languages');

  const [languages, setLanguages] = useState<Language[]>([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState<AddForm>(defaultAddForm);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ code: '', name: '', nativeName: '' });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${accessToken}`,
  }), [accessToken]);

  const fetchLanguages = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API}/api/v1/languages`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setLanguages(Array.isArray(data) ? data : data.languages ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch languages:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, authHeaders]);

  useEffect(() => { fetchLanguages(); }, [fetchLanguages]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    const code = addForm.code.trim();
    const name = addForm.name.trim();
    const nativeName = addForm.nativeName.trim();
    if (!code || !name || !nativeName) {
      setAddError(t('allFieldsRequired'));
      return;
    }
    if (code.length !== 2) {
      setAddError(t('codeMustBe2'));
      return;
    }
    setIsAdding(true);
    try {
      const res = await fetch(`${API}/api/v1/languages`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, nativeName }),
      });
      if (res.ok) {
        setAddForm(defaultAddForm);
        await fetchLanguages();
      } else {
        const err = await res.json().catch(() => ({}));
        setAddError(err.error ?? err.message ?? `Error ${res.status}`);
      }
    } catch {
      setAddError(t('networkError'));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleToggleActive(lang: Language) {
    if (togglingId) return;
    setTogglingId(lang.id);
    try {
      await fetch(`${API}/api/v1/languages/${lang.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !lang.isActive }),
      });
      await fetchLanguages();
    } catch (err) {
      console.error('Failed to toggle language:', err);
    } finally {
      setTogglingId(null);
    }
  }

  function startEdit(lang: Language) {
    setEditingId(lang.id);
    setEditForm({ code: lang.code, name: lang.name, nativeName: lang.nativeName });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleSaveEdit(id: string) {
    setIsSavingEdit(true);
    try {
      const res = await fetch(`${API}/api/v1/languages/${id}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: editForm.code.trim(),
          name: editForm.name.trim(),
          nativeName: editForm.nativeName.trim(),
        }),
      });
      if (res.ok) {
        setEditingId(null);
        await fetchLanguages();
      }
    } catch (err) {
      console.error('Failed to save language:', err);
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`${API}/api/v1/languages/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setConfirmDeleteId(null);
      await fetchLanguages();
    } catch (err) {
      console.error('Failed to delete language:', err);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const res = await fetch(`${API}/api/v1/languages/export`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'languages.json';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to export languages:', err);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await fetch(`${API}/api/v1/languages/import`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      await fetchLanguages();
    } catch (err) {
      console.error('Failed to import languages:', err);
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="h-8 w-8 text-muted-foreground" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Download className="mr-2 h-4 w-4" />}
            {t('exportJSON')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => importInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Upload className="mr-2 h-4 w-4" />}
            {t('importJSON')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>

      {/* Add Language Form */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold mb-3">{t('addLanguage')}</h2>
        <form onSubmit={handleAdd} className="flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('code')}</label>
            <Input
              value={addForm.code}
              onChange={(e) => setAddForm((f) => ({ ...f, code: e.target.value }))}
              placeholder={t('codePlaceholder')}
              maxLength={2}
              className="w-20"
              disabled={isAdding}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('nameLabel')}</label>
            <Input
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('namePlaceholder')}
              className="w-40"
              disabled={isAdding}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('nativeNameLabel')}</label>
            <Input
              value={addForm.nativeName}
              onChange={(e) => setAddForm((f) => ({ ...f, nativeName: e.target.value }))}
              placeholder={t('nativeNamePlaceholder')}
              className="w-40"
              disabled={isAdding}
            />
          </div>
          <Button type="submit" disabled={isAdding}>
            {isAdding
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Plus className="mr-2 h-4 w-4" />}
            {t('addLanguage')}
          </Button>
        </form>
        {addError && (
          <p className="text-sm text-red-500 mt-2">{addError}</p>
        )}
      </div>

      {/* Languages Table */}
      <div className="rounded-lg border bg-card">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">{t('allLanguages')}</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : languages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            {t('noLanguages')}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-20">{t('code')}</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t('nameLabel')}</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t('nativeNameLabel')}</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-24">{t('activeStatus')}</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground w-32">{t('edit')}</th>
              </tr>
            </thead>
            <tbody>
              {languages.map((lang) => {
                const isEditing = editingId === lang.id;
                return (
                  <tr key={lang.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    {isEditing ? (
                      <>
                        <td className="px-4 py-2">
                          <Input
                            value={editForm.code}
                            onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value }))}
                            maxLength={2}
                            className="h-7 w-16 text-sm"
                            disabled={isSavingEdit}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <Input
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            className="h-7 text-sm"
                            disabled={isSavingEdit}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <Input
                            value={editForm.nativeName}
                            onChange={(e) => setEditForm((f) => ({ ...f, nativeName: e.target.value }))}
                            className="h-7 text-sm"
                            disabled={isSavingEdit}
                          />
                        </td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">—</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700"
                              onClick={() => handleSaveEdit(lang.id)}
                              disabled={isSavingEdit}
                              title={t('save')}
                            >
                              {isSavingEdit
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Check className="h-3.5 w-3.5" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={cancelEdit}
                              disabled={isSavingEdit}
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="font-mono text-xs uppercase">
                            {lang.code}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 font-medium">{lang.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{lang.nativeName}</td>
                        <td className="px-4 py-2.5">
                          <Switch
                            checked={lang.isActive}
                            onCheckedChange={() => handleToggleActive(lang)}
                            disabled={togglingId === lang.id}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          {confirmDeleteId === lang.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-xs text-muted-foreground mr-1">{t('deleteConfirm')}</span>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => handleDelete(lang.id)}
                                disabled={deletingId === lang.id}
                              >
                                {deletingId === lang.id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : t('yes')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                {t('no')}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => startEdit(lang)}
                                title={t('edit')}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => setConfirmDeleteId(lang.id)}
                                title={t('delete')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

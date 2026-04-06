"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type OrgStatus = 'active' | 'suspended' | 'deleted';
type OrgPlan = 'free' | 'starter' | 'pro' | 'enterprise';

interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  status: OrgStatus;
  maxUsers?: number;
  maxProjects?: number;
}

interface OrgFormState {
  name: string;
  slug: string;
  plan: OrgPlan;
  maxUsers: string;
  maxProjects: string;
}

const defaultForm: OrgFormState = {
  name: '',
  slug: '',
  plan: 'free',
  maxUsers: '',
  maxProjects: '',
};

function statusVariant(status: OrgStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'suspended') return 'secondary';
  return 'destructive';
}

function statusColor(status: OrgStatus): string {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'suspended') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

export default function AdminOrganizationsPage() {
  const { accessToken } = useAuth();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [form, setForm] = useState<OrgFormState>(defaultForm);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete confirmation dialog
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchOrgs = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API}/api/v1/organizations`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOrgs(Array.isArray(data) ? data : data.organizations ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  function openCreate() {
    setEditingOrg(null);
    setForm(defaultForm);
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(org: Organization) {
    setEditingOrg(org);
    setForm({
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      maxUsers: org.maxUsers != null ? String(org.maxUsers) : '',
      maxProjects: org.maxProjects != null ? String(org.maxProjects) : '',
    });
    setFormError('');
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim() || !form.slug.trim()) {
      setFormError('Name and slug are required.');
      return;
    }
    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        plan: form.plan,
      };
      if (form.maxUsers) body.maxUsers = parseInt(form.maxUsers, 10);
      if (form.maxProjects) body.maxProjects = parseInt(form.maxProjects, 10);

      const url = editingOrg
        ? `${API}/api/v1/organizations/${editingOrg.id}`
        : `${API}/api/v1/organizations`;
      const method = editingOrg ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setDialogOpen(false);
        await fetchOrgs();
      } else {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error ?? err.message ?? `Error ${res.status}`);
      }
    } catch (err) {
      setFormError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleStatus(org: Organization) {
    if (!accessToken) return;
    const newStatus: OrgStatus = org.status === 'active' ? 'suspended' : 'active';
    try {
      await fetch(`${API}/api/v1/organizations/${org.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchOrgs();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || !accessToken) return;
    setIsDeleting(true);
    try {
      await fetch(`${API}/api/v1/organizations/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setDeleteTarget(null);
      await fetchOrgs();
    } catch (err) {
      console.error('Failed to delete organization:', err);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create Organization
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Organizations</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No organizations found.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/organizations/${org.id}`}
                        className="hover:underline text-primary"
                      >
                        {org.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{org.slug}</TableCell>
                    <TableCell>
                      <span className="capitalize text-sm">{org.plan}</span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`capitalize border ${statusColor(org.status)}`}
                        variant="outline"
                      >
                        {org.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(org)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleStatus(org)}
                          disabled={org.status === 'deleted'}
                          title={org.status === 'active' ? 'Suspend' : 'Activate'}
                        >
                          {org.status === 'active' ? 'Suspend' : 'Activate'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(org)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingOrg ? 'Edit Organization' : 'Create Organization'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Acme Corp"
                disabled={isSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">Slug</Label>
              <Input
                id="org-slug"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="acme-corp"
                disabled={isSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-plan">Plan</Label>
              <Select
                value={form.plan}
                onValueChange={(v) => setForm((f) => ({ ...f, plan: v as OrgPlan }))}
                disabled={isSaving}
              >
                <SelectTrigger id="org-plan">
                  <SelectValue placeholder="Select plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="org-maxUsers">Max Users</Label>
                <Input
                  id="org-maxUsers"
                  type="number"
                  min={1}
                  value={form.maxUsers}
                  onChange={(e) => setForm((f) => ({ ...f, maxUsers: e.target.value }))}
                  placeholder="50"
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-maxProjects">Max Projects</Label>
                <Input
                  id="org-maxProjects"
                  type="number"
                  min={1}
                  value={form.maxProjects}
                  onChange={(e) => setForm((f) => ({ ...f, maxProjects: e.target.value }))}
                  placeholder="10"
                  disabled={isSaving}
                />
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-500">{formError}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingOrg ? 'Save Changes' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Organization</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

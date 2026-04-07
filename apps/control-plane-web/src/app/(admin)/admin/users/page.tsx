"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/context/AuthContext';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const LIMIT = 50;

interface OrgMembership {
  orgId: string;
  orgName: string;
}

interface AdminUser {
  id: string;
  email: string;
  status: 'active' | 'locked' | 'pending';
  isSuperAdmin: boolean;
  memberships: OrgMembership[];
  createdAt: string;
}

interface UsersResponse {
  users?: AdminUser[];
  data?: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

function statusColor(status: string): string {
  if (status === 'active') return 'bg-green-500 hover:bg-green-500';
  if (status === 'locked') return 'bg-red-500 hover:bg-red-500';
  return 'bg-amber-500 hover:bg-amber-500';
}

export default function AdminUsersPage() {
  const { accessToken } = useAuth();
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createIsSuperAdmin, setCreateIsSuperAdmin] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editIsSuperAdmin, setEditIsSuperAdmin] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Assign org dialog state
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUser, setAssignUser] = useState<AdminUser | null>(null);
  const [assignOrgId, setAssignOrgId] = useState('');
  const [assignRole, setAssignRole] = useState('read_only');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const fetchUsers = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(`${API}/api/v1/admin/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Failed to fetch users (${res.status})`);
      const json: UsersResponse = await res.json();
      setUsers(json.users ?? json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, search, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const handleToggleStatus = async (user: AdminUser) => {
    if (!accessToken) return;
    const newStatus = user.status === 'locked' ? 'active' : 'locked';
    setTogglingId(user.id);
    try {
      const res = await fetch(`${API}/api/v1/admin/users/${user.id}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`Failed to update status (${res.status})`);
      await fetchUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update user status');
    } finally {
      setTogglingId(null);
    }
  };

  // Create handlers
  const openCreateDialog = () => {
    setCreateEmail('');
    setCreatePassword('');
    setCreateIsSuperAdmin(false);
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!accessToken) return;
    if (!createEmail.trim() || !createPassword.trim()) {
      setCreateError('Email and password are required.');
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: createEmail.trim(),
          password: createPassword,
          isSuperAdmin: createIsSuperAdmin,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Failed to create user (${res.status})`);
      }
      setCreateOpen(false);
      await fetchUsers();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreateLoading(false);
    }
  };

  // Edit handlers
  const openEditDialog = (user: AdminUser) => {
    setEditUser(user);
    setEditEmail(user.email);
    setEditPassword('');
    setEditIsSuperAdmin(user.isSuperAdmin);
    setEditError(null);
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!accessToken || !editUser) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const body: { email?: string; password?: string; isSuperAdmin?: boolean } = {};
      if (editEmail.trim() && editEmail.trim() !== editUser.email) {
        body.email = editEmail.trim();
      }
      if (editPassword.trim()) {
        body.password = editPassword;
      }
      if (editIsSuperAdmin !== editUser.isSuperAdmin) {
        body.isSuperAdmin = editIsSuperAdmin;
      }
      const res = await fetch(`${API}/api/v1/admin/users/${editUser.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resBody = await res.json().catch(() => ({}));
        throw new Error(resBody?.message ?? `Failed to update user (${res.status})`);
      }
      setEditOpen(false);
      await fetchUsers();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setEditLoading(false);
    }
  };

  // Delete handlers
  const openDeleteDialog = (user: AdminUser) => {
    setDeleteUser(user);
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!accessToken || !deleteUser) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/users/${deleteUser.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Failed to delete user (${res.status})`);
      }
      setDeleteOpen(false);
      await fetchUsers();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Fetch orgs for assign dialog
  const fetchOrgs = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API}/api/v1/organizations`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOrgs(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, [accessToken]);

  const openAssignDialog = (user: AdminUser) => {
    setAssignUser(user);
    setAssignOrgId('');
    setAssignRole('read_only');
    setAssignError(null);
    setAssignOpen(true);
    fetchOrgs();
  };

  const handleAssignOrg = async () => {
    if (!accessToken || !assignUser || !assignOrgId) return;
    setAssignLoading(true);
    setAssignError(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/users/${assignUser.id}/assign-org`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: assignOrgId, roleName: assignRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      setAssignOpen(false);
      await fetchUsers();
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleRemoveOrg = async (userId: string, orgId: string) => {
    if (!accessToken) return;
    try {
      await fetch(`${API}/api/v1/admin/users/${userId}/remove-org`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      await fetchUsers();
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          {t('createUser')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <Input
          placeholder={t('searchByEmail')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={tc('status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allUsers')}</SelectItem>
            <SelectItem value="active">{t('active')}</SelectItem>
            <SelectItem value="locked">{t('locked')}</SelectItem>
            <SelectItem value="pending">{t('pending')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('users')} {total > 0 && <span className="text-muted-foreground font-normal text-base">({total} {t('total')})</span>}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">{tc('loading')}</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">{t('noUsers')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('tableEmail')}</TableHead>
                  <TableHead>{t('tableStatus')}</TableHead>
                  <TableHead>{t('superAdmin')}</TableHead>
                  <TableHead>{t('organizations')}</TableHead>
                  <TableHead>{t('createdAt')}</TableHead>
                  <TableHead className="text-right">{t('tableActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>
                      <Badge className={`capitalize text-white ${statusColor(user.status)}`}>
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.isSuperAdmin && (
                        <Badge variant="secondary">{t('superAdmin')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm max-w-xs">
                      <div className="flex flex-wrap items-center gap-1">
                        {user.memberships?.map((m) => (
                          <Badge key={m.orgId} variant="outline" className="gap-1 pr-1">
                            {m.orgName}
                            <button
                              className="ml-1 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveOrg(user.id, m.orgId)}
                              title="Remove from org"
                            >×</button>
                          </Badge>
                        ))}
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openAssignDialog(user)} title="Assign to organization">
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant={user.status === 'locked' ? 'default' : 'destructive'}
                          size="sm"
                          disabled={togglingId === user.id}
                          onClick={() => handleToggleStatus(user)}
                        >
                          {togglingId === user.id
                            ? t('saving')
                            : user.status === 'locked'
                            ? t('unlock')
                            : t('lock')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(user)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openDeleteDialog(user)}
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t('pageOf')} {page} {t('of')} {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            {t('previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            {t('next')}
          </Button>
        </div>
      </div>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createUserDialog')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {createError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {createError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="create-email">{t('emailLabel')}</Label>
              <Input
                id="create-email"
                type="email"
                placeholder={t('emailPlaceholder')}
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-password">{t('passwordLabel')}</Label>
              <Input
                id="create-password"
                type="password"
                placeholder={t('passwordPlaceholder')}
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="create-superadmin"
                checked={createIsSuperAdmin}
                onCheckedChange={(checked) => setCreateIsSuperAdmin(checked === true)}
              />
              <Label htmlFor="create-superadmin">{t('superAdminCheckbox')}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createLoading}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={createLoading}>
              {createLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tc('add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editUserDialog')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {editError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-email">{t('emailLabel')}</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">{t('newPassword')}</Label>
              <Input
                id="edit-password"
                type="password"
                placeholder={t('leaveEmpty')}
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-superadmin"
                checked={editIsSuperAdmin}
                onCheckedChange={(checked) => setEditIsSuperAdmin(checked === true)}
              />
              <Label htmlFor="edit-superadmin">{t('superAdminCheckbox')}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editLoading}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleEdit} disabled={editLoading}>
              {editLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tc('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign to Org Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assignOrgDialog')} {assignUser?.email} {t('assignUserToOrg')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {assignError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {assignError}
              </div>
            )}
            <div className="space-y-2">
              <Label>{t('organizationLabel')}</Label>
              <Select value={assignOrgId} onValueChange={(v) => v && setAssignOrgId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectOrganization')} />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('roleLabel')}</Label>
              <Select value={assignRole} onValueChange={(v) => v && setAssignRole(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="organization_owner">{t('organizationOwner')}</SelectItem>
                  <SelectItem value="organization_admin">{t('organizationAdmin')}</SelectItem>
                  <SelectItem value="manager">{t('manager')}</SelectItem>
                  <SelectItem value="operator">{t('operator')}</SelectItem>
                  <SelectItem value="reviewer">{t('reviewer')}</SelectItem>
                  <SelectItem value="analyst">{t('analyst')}</SelectItem>
                  <SelectItem value="read_only">{t('readOnly')}</SelectItem>
                  <SelectItem value="service_user">{t('serviceUser')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={assignLoading}>{tc('cancel')}</Button>
            <Button onClick={handleAssignOrg} disabled={assignLoading || !assignOrgId}>
              {assignLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('assignOrgDialog')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteUserDialog')}</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {deleteError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {deleteError}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {t('deleteConfirm')}{' '}
              <span className="font-medium text-foreground">{deleteUser?.email}</span>?{' '}
              {t('actionCannotUndo')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteLoading}>
              {tc('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

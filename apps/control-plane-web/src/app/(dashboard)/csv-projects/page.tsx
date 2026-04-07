"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Plus, FileSpreadsheet, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';

const CSV_API = process.env.NEXT_PUBLIC_CSV_API_URL || 'http://localhost:4001';

interface Project {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: string;
}

export default function CSVProjectsPage() {
  const t = useTranslations('csvProjects');
  const router = useRouter();
  const { accessToken } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);

  const loadProjects = () => {
    if (!accessToken) return;
    setIsLoading(true);
    fetch(`${CSV_API}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
      .then(r => r.json())
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadProjects();
  }, [accessToken]);

  const handleNewProject = async () => {
    if (!accessToken) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${CSV_API}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ name: `Project ${new Date().toLocaleDateString('en-GB')}` })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t('createError'));
      }
      const project: Project = await res.json();
      router.push(`/csv-projects/${project.id}`);
    } catch (err: any) {
      setCreateError(err.message);
      setIsCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!accessToken) return;
    
    try {
      const res = await fetch(`${CSV_API}/projects/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== id));
        setProjectToDelete(null);
      } else {
        const err = await res.json();
        alert(`Failed to delete: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Error deleting project: ${err.message}`);
    }
  };

  const statusColors: Record<string, string> = {
    PENDING: 'bg-zinc-100 text-zinc-800',
    PARSED: 'bg-blue-100 text-blue-800',
    SCHEMA_REVIEW: 'bg-amber-100 text-amber-800',
    ENRICHING: 'bg-indigo-100 text-indigo-800',
    NEEDS_COLLISION_REVIEW: 'bg-red-100 text-red-800',
    READY: 'bg-emerald-100 text-emerald-800',
    DONE: 'bg-emerald-100 text-emerald-800',
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <Button onClick={handleNewProject} disabled={isCreating} className="gap-2">
          {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t('newProject')}
        </Button>
      </div>

      {createError && (
        <p className="text-sm text-red-500">{createError}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('recentProjects')}</CardTitle>
          <CardDescription>{t('trackStatusResume')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed rounded-lg">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">{t('noProjectsYet')}</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">{t('startByCreating')}</p>
              <Button onClick={handleNewProject} variant="outline">{t('createFirstProject')}</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('projectName')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead>{t('created')}</TableHead>
                  <TableHead className="text-right">{t('action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="font-medium flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                      {project.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusColors[project.status] || statusColors.PENDING}>
                        {project.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(project.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {projectToDelete === project.id ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setProjectToDelete(null); }} className="text-muted-foreground">{t('cancelDelete')}</Button>
                            <Button variant="default" size="sm" onClick={(e) => handleDelete(e, project.id)} className="bg-red-600 hover:bg-red-700 text-white">{t('deleteConfirm')}</Button>
                          </>
                        ) : (
                          <>
                            <Link href={`/csv-projects/${project.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                              {t('open')}
                            </Link>
                            <Button variant="ghost" size="sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setProjectToDelete(project.id); }} className="text-red-500 hover:text-red-600 hover:bg-red-50">
                              {t('deleteConfirm')}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

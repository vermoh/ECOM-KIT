import { AdminLayoutClient } from '@/components/layout/AdminLayoutClient';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}

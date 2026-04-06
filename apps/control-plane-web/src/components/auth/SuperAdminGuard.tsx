"use client";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

interface SuperAdminGuardProps {
  children: React.ReactNode;
}

export function SuperAdminGuard({ children }: SuperAdminGuardProps) {
  const { claims, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !claims?.roles?.includes("super_admin")) {
      router.replace("/dashboard");
    }
  }, [isLoading, claims, router]);

  if (isLoading || !claims?.roles?.includes("super_admin")) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}

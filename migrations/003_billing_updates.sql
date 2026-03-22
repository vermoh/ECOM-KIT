-- Migration 003: Billing and Token Quotas

-- Create Token Budgets table
CREATE TABLE IF NOT EXISTS token_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    total_tokens BIGINT NOT NULL DEFAULT 100000,
    remaining_tokens BIGINT NOT NULL DEFAULT 100000,
    reset_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '30 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE(org_id)
);

-- Create Token Usage Logs table
CREATE TABLE IF NOT EXISTS token_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    service_id UUID REFERENCES services(id),
    job_id UUID,
    tokens_used INTEGER NOT NULL,
    model TEXT,
    purpose TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Add Stripe fields to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_customer_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_id TEXT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS token_usage_logs_org_id_idx ON token_usage_logs(org_id);
CREATE INDEX IF NOT EXISTS token_usage_logs_created_at_idx ON token_usage_logs(created_at);

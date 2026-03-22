export interface AccessGrant {
  id: string;
  sourceService: string;
  targetService: string;
  orgId: string;
  permissions: string[];
  expiresAt: Date;
}

export interface UserSession {
  userId: string;
  orgId: string;
  roles: string[];
  permissions: string[];
  exp: number;
  validUntil?: string; // ISO date string
}

export interface SchemaField {
  id: string;
  orgId: string;
  schemaId: string;
  name: string;
  label: string;
  fieldType: 'text' | 'number' | 'boolean' | 'enum' | 'url';
  isRequired: boolean;
  allowedValues?: string[];
  description?: string;
  sortOrder: number;
}

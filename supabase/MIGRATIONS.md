# Database Migrations Setup

This project uses Supabase CLI to manage database migrations.

## Getting Started

1. **Install dependencies** (if not already done):

   ```bash
   npm install
   ```

2. **Initialize Supabase** (if not already done):

   ```bash
   npx supabase link --project-ref zerohasslelandlord
   ```

   When prompted, enter your Supabase access token from: https://app.supabase.com/account/tokens

3. **Push migrations to your database**:
   ```bash
   npx supabase db push
   ```

## Available Commands

- **Push migrations**: `npx supabase db push` - Applies all pending migrations
- **Create new migration**: `npx supabase migration new <name>` - Creates a new migration file
- **Pull remote schema**: `npx supabase db pull` - Pulls current schema from remote database
- **Reset database**: `npx supabase db reset` - Resets local database to initial state

## Migration Structure

Migrations are stored in `supabase/migrations/` with timestamp format:

- Format: `YYYYMMDDHHMMSS_description.sql`
- Current migration: `20260217000000_create_accounts_table.sql`

## Current Migration: Accounts Table

Creates the `accounts` table with the following columns:

- `id` - UUID primary key
- `user_id` - UUID foreign key referencing auth.users
- `display_name` - VARCHAR(255)
- `email` - VARCHAR(255)
- `phone` - VARCHAR(20) (nullable)
- `password_hash` - VARCHAR(255)
- `created_at` - Timestamp
- `updated_at` - Timestamp (auto-updated)

Includes:

- Row Level Security (RLS) policies
- Automatic `updated_at` trigger
- Indexed columns for better query performance

## Notes

- Never modify applied migrations directly
- Create new migrations for schema changes
- The migration file is idempotent and safe to run multiple times

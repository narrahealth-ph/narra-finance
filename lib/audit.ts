import { query } from './db'

/**
 * Write an immutable audit log entry.
 * Errors are swallowed so a logging failure never breaks the main operation.
 */
export async function writeAudit(
  tableName: string,
  recordId: number | string | null,
  action: string,
  oldValue: any,
  newValue: any,
  userEmail: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (table_name, record_id, action, old_value, new_value, user_email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tableName,
        recordId !== null ? String(recordId) : null,
        action,
        oldValue !== null ? JSON.stringify(oldValue) : null,
        newValue !== null ? JSON.stringify(newValue) : null,
        userEmail || 'system',
      ]
    )
  } catch (err) {
    console.error('[audit] Failed to write audit log:', err)
  }
}

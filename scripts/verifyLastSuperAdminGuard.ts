import { assertCanRemoveSuperAdmin } from '../src/features/super-admins/super-admins.service';
import { ValidationError } from '../src/utils/errors';

try {
  // Stubbed repository count: this runs no database query and cannot touch real Super Admin rows.
  assertCanRemoveSuperAdmin(1);
  throw new Error('Last-admin guard did not reject');
} catch (error) {
  if (
    !(error instanceof ValidationError) ||
    error.message !== 'Cannot remove the last remaining Super Admin'
  )
    throw error;
  console.log(
    JSON.stringify({
      count: 1,
      statusCode: error.statusCode,
      code: error.code,
      error: error.message,
    })
  );
}

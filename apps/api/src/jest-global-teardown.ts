import { dropPreparedDatabase } from './test-database';

export default function globalTeardown(): void {
  dropPreparedDatabase();
}

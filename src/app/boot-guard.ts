/**
 * Imported first by main.ts, so the error boundary is in place before any
 * other module runs (a module that throws while loading would otherwise
 * leave a blank window). See errors.ts.
 */
import { installErrorBoundary } from './errors';

installErrorBoundary();
performance.mark('orbit-boot');

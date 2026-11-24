import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createDemoEmployeesService,
  createDemoStore,
  type DemoStore,
} from '../adapters/demo/demo-service';
import { DEMO_PERSONAS, type DemoPersonaKey } from '../adapters/demo/demo-sessions';
import { EmployeesContextProvider } from '../state/employees-context';
import type { EmployeesService } from '../service';

export interface RenderOptions {
  persona?: DemoPersonaKey;
  /** Wrap or replace the service, e.g. to spy or to inject failures. */
  wrap?: (service: EmployeesService, store: DemoStore) => EmployeesService;
  /** Mutate the seed before rendering (e.g. empty the directory). */
  prepare?: (store: DemoStore) => void;
}

/** Renders UI against the DEMO adapter (fictional in-memory data, zero latency). */
export function renderEmployees(
  ui: React.ReactElement,
  { persona = 'hr', wrap, prepare }: RenderOptions = {},
) {
  const store = createDemoStore();
  prepare?.(store);
  const session = DEMO_PERSONAS[persona];
  const base = createDemoEmployeesService(store, () => session, { latencyMs: 0 });
  const service = wrap ? wrap(base, store) : base;
  const utils = render(
    <EmployeesContextProvider service={service} session={session}>
      {ui}
    </EmployeesContextProvider>,
  );
  return { ...utils, service, store, user: userEvent.setup() };
}

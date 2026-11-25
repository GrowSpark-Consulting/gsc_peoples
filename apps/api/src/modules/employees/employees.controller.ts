import type { RequestHandler } from 'express';
import type {
  ChangeEmployeeStatus,
  CreateEmployee,
  DirectoryQuery,
  EmployeeListQuery,
  RoleKey,
  EmployeeSelfUpdate,
  UpdateEmployee,
} from '@gsc/contracts';
import { UnauthorizedError } from '../../shared/errors';
import type { EmployeeService } from './employees.service';

/** HTTP only: unpack validated input, call the service, shape the response. */
export function createEmployeeController(service: EmployeeService) {
  const user = (req: Parameters<RequestHandler>[0]) => {
    if (!req.user) throw new UnauthorizedError();
    return req.user;
  };
  const id = (req: Parameters<RequestHandler>[0]) => (req.params as { id: string }).id;

  const list: RequestHandler = async (req, res) => {
    res.json(await service.list(user(req), req.query as unknown as EmployeeListQuery));
  };
  const get: RequestHandler = async (req, res) => {
    res.json({ data: await service.get(user(req), id(req)) });
  };
  const getMe: RequestHandler = async (req, res) => {
    const u = user(req);
    if (!u.employeeId) throw new UnauthorizedError('Employee profile not found');
    res.json({ data: await service.get(u, u.employeeId) });
  };
  const create: RequestHandler = async (req, res) => {
    res.status(201).json({ data: await service.create(user(req), req.body as CreateEmployee) });
  };
  const update: RequestHandler = async (req, res) => {
    res.json({ data: await service.update(user(req), id(req), req.body as UpdateEmployee) });
  };
  const selfUpdate: RequestHandler = async (req, res) => {
    res.json({ data: await service.selfUpdate(user(req), req.body as EmployeeSelfUpdate) });
  };
  const changeStatus: RequestHandler = async (req, res) => {
    res.json({
      data: await service.changeStatus(user(req), id(req), req.body as ChangeEmployeeStatus),
    });
  };
  const timeline: RequestHandler = async (req, res) => {
    res.json(await service.timeline(user(req), id(req)));
  };
  const invite: RequestHandler = async (req, res) => {
    const body = (req.body ?? {}) as { roleKey?: RoleKey };
    res.status(202).json({ data: await service.sendInvitation(user(req), id(req), body.roleKey) });
  };
  const directory: RequestHandler = async (req, res) => {
    res.json(await service.directory(user(req), req.query as unknown as DirectoryQuery));
  };

  return { list, get, getMe, create, update, selfUpdate, changeStatus, timeline, invite, directory };
}

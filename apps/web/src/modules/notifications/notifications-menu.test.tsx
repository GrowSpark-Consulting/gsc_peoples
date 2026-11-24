// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, uuid } from '@/test/api-mock';
import { NotificationsMenu, safeLink } from './notifications-menu';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const n = (o: Record<string, unknown> = {}) => ({
  id: uuid(), type: 'leave.requested', title: 'Leave requested', message: 'Olivia asked for leave', link: '/leave', isRead: false,
  createdAt: '2026-03-02T05:00:00.000Z', readAt: null, ...o,
});
const list = (items: unknown[], unreadCount = items.filter((i) => !(i as { isRead: boolean }).isRead).length) => ({
  body: { data: items, unreadCount, page: { page: 1, pageSize: 10, total: items.length } },
});

describe('safeLink', () => {
  it('follows only same-site paths', () => {
    expect(safeLink('/leave')).toBe('/leave');
    expect(safeLink('https://evil.example')).toBeNull();
    expect(safeLink('//evil.example')).toBeNull();
    expect(safeLink(null)).toBeNull();
  });
});

describe('Notifications (NOTIF-001)', () => {
  it('shows the unread count on the bell and lists the notifications', async () => {
    mockApi({ 'GET /notifications': list([n(), n({ isRead: true, title: 'Old news' })]) });
    render(<NotificationsMenu />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await userEvent.click(bell);
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(dialog).getByText('Leave requested')).toBeTruthy();
    expect(within(dialog).getByText('Old news')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Leave requested' }).getAttribute('href')).toBe('/leave');
  });

  it('marks one notification read and refreshes the badge', async () => {
    const first = n({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    let read = false;
    const api = mockApi({
      'GET /notifications': () => list([{ ...first, isRead: read }]),
      'PATCH /notifications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/read': () => {
        read = true;
        return { body: { data: {} } };
      },
    });
    render(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(api.keys()).toContain('PATCH /notifications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/read'));
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
  });

  it('marks all as read', async () => {
    let read = false;
    const api = mockApi({
      'GET /notifications': () => list([n({ isRead: read }), n({ isRead: read })]),
      'PATCH /notifications/read-all': () => {
        read = true;
        return { body: { data: {} } };
      },
    });
    render(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(api.keys()).toContain('PATCH /notifications/read-all'));
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
  });

  it('empty and error states', async () => {
    mockApi({ 'GET /notifications': list([]) });
    const a = render(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('You are all caught up.')).toBeTruthy();
    a.unmount();
    mockApi({ 'GET /notifications': apiError(500, 'INTERNAL', 'x') });
    render(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText(/Something went wrong on our side/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

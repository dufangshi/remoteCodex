import { act, fireEvent, render, screen } from '@testing-library/react';
import { setLocale } from '@pockymoe/thread-ui/i18n';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAuthSession } from '../../lib/api';
import { TourLauncherButton, TourProvider } from './TourProvider';
import { placeCard } from './tourPlacement';
import { progressStorageKey, readProgress } from './tourStorage';

vi.mock('../../lib/api', () => ({
  fetchAuthSession: vi.fn(),
  fetchRelaySession: vi.fn(),
  readSelectedRelayDeviceId: () => null,
  relayModeActive: () => false,
}));

const viewport = { width: 1440, height: 900 };
const card = { width: 360, height: 200 };

describe('tour card placement', () => {
  it('sits beside the target, inside the viewport, without covering it', () => {
    const top = placeCard({ top: 10, left: 1380, width: 40, height: 40 }, card, viewport);
    expect(top).toMatchObject({ placement: 'bottom', top: 62 });
    expect(top.left + card.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(placeCard({ top: 830, left: 1200, width: 40, height: 40 }, card, viewport)).toMatchObject({ placement: 'top', top: 618 });
    // A tall sidebar gets the card next to it.
    expect(placeCard({ top: 40, left: 48, width: 240, height: 860 }, card, viewport)).toMatchObject({ placement: 'right', left: 300 });
  });

  it('docks on a phone when no side fits and keeps the head of tall targets visible', () => {
    const phone = { width: 393, height: 727 };
    const phoneCard = { width: 377, height: 190 };
    expect(placeCard({ top: 52, left: 0, width: 393, height: 675 }, phoneCard, phone)).toMatchObject({ placement: 'dock-bottom', top: 529 });
    expect(placeCard({ top: 170, left: 0, width: 393, height: 400 }, phoneCard, phone).placement).toBe('dock-top');
    expect(placeCard(null, phoneCard, phone, 'bottom')).toMatchObject({ placement: 'dock-bottom', left: 8 });
  });
});

describe('tour progress', () => {
  it('scopes progress per origin and account and tolerates corrupt storage', () => {
    expect(progressStorageKey('local:alice', 'http://a')).not.toBe(progressStorageKey('local:bob', 'http://a'));
    expect(progressStorageKey('local:alice', 'http://a')).not.toBe(progressStorageKey('local:alice', 'http://b'));
    localStorage.setItem('broken', '{');
    expect(readProgress('broken')).toEqual({ welcomeDismissed: false, completed: [], resume: {} });
  });
});

describe('tour provider', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setLocale('en', false);
  });
  afterEach(() => vi.useRealTimers());

  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <TourProvider>
          <header className="product-topbar">Workspaces</header>
          <TourLauncherButton />
        </TourProvider>
      </MemoryRouter>,
    );
  }

  it('offers onboarding after logging in on the same mounted app, with a compact labelled entry', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValueOnce({username:null,mode:'local',authRequired:true,authenticated:false,expiresAt:null})
      .mockResolvedValue({username:'new-user',mode:'local',authRequired:true,authenticated:true,expiresAt:null});
    function Login() { const navigate = useNavigate(); return <button onClick={() => navigate('/workspaces')}>Log in</button>; }
    render(<MemoryRouter initialEntries={['/login']}><TourProvider><Login/><TourLauncherButton showLabel/></TourProvider></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('dialog', {name:'New to Pockymoe?'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Log in'}));
    expect(await screen.findByRole('dialog',{name:'New to Pockymoe?'})).toBeVisible();
    expect(screen.getByRole('button',{name:'Tutorial'})).toHaveTextContent('Tutorial');
  });

  it('offers the tour once per account and remembers "Later" without leaking to another user', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue({ username: 'alice', mode: 'local', authRequired: true, authenticated: true, expiresAt: null });
    const first = renderAt('/workspaces');
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog', { name: 'New to Pockymoe?' })).toBeNull();
    expect(readProgress(progressStorageKey('local:alice')).welcomeDismissed).toBe(true);
    first.unmount();

    vi.mocked(fetchAuthSession).mockResolvedValue({ username: 'bob', mode: 'local', authRequired: true, authenticated: true, expiresAt: null });
    renderAt('/workspaces');
    expect(await screen.findByRole('dialog', { name: 'New to Pockymoe?' })).toBeVisible();
  });

  it('explains a missing control instead of pointing at an unrelated element, and Escape closes', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue({ username: null, mode: 'local', authRequired: false, authenticated: true, expiresAt: null });
    localStorage.setItem(progressStorageKey('local:owner'), JSON.stringify({ welcomeDismissed: true, completed: [], resume: {} }));
    renderAt('/threads/thread-1');
    fireEvent.click(screen.getByRole('button', { name: 'Tutorial' }));
    fireEvent.click(await screen.findByRole('button', { name: /Terminal/ }));
    // jsdom lays nothing out, so the terminal toggle counts as absent.
    const step = await screen.findByRole('dialog', { name: 'Open the terminal' }, { timeout: 2000 });
    expect(step).toHaveTextContent('Waiting for this control');
    expect(document.querySelector('.pm-tour-spotlight')).toBeNull();
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Open the terminal' })).toBeNull();
    expect(readProgress(progressStorageKey('local:owner')).resume.terminal).toBe('open');
  });
});

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  FileText,
  Home,
  Image,
  Instagram,
  LayoutDashboard,
  Lightbulb,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  Settings,
  Sparkles,
  TrendingUp,
  X,
  Facebook,
  Building2,
} from 'lucide-react';
import { api, auth } from '@appdeploy/client';

const platforms = [
  { name: 'Facebook', icon: Facebook, tone: 'blue', followers: '—' },
  { name: 'Instagram', icon: Instagram, tone: 'rose', followers: '—' },
  { name: 'Threads', icon: MessageCircle, tone: 'slate', followers: '—' },
];

function ClientsWorkspace({ clients, form, setForm, formOpen, setFormOpen, editingClient, setEditingClient, onSave, onEdit, onDelete }: {
  clients: Array<{ id: string; businessName: string; contactName?: string; email?: string; phone?: string; notes?: string; status?: string }>;
  form: { businessName: string; contactName: string; email: string; phone: string; notes: string; status: string };
  setForm: (value: { businessName: string; contactName: string; email: string; phone: string; notes: string; status: string }) => void;
  formOpen: boolean; setFormOpen: (value: boolean) => void; editingClient: string | null; setEditingClient: (value: string | null) => void;
  onSave: () => void; onEdit: (client: { id: string; businessName: string; contactName?: string; email?: string; phone?: string; notes?: string; status?: string }) => void; onDelete: (id: string) => void;
}) {
  const [demoWorkspaceClient, setDemoWorkspaceClient] = useState<{ id: string; businessName: string } | null>(null);
  const [demoChecklistOpen, setDemoChecklistOpen] = useState(false);
  const [invitationPreview, setInvitationPreview] = useState('');
  const [realInvitation, setRealInvitation] = useState('');
  const [realInvitationBusy, setRealInvitationBusy] = useState(false);
  const [realInvitationError, setRealInvitationError] = useState('');
  const createRealInvitation = async () => {
    if (!demoWorkspaceClient || realInvitationBusy) return;
    setRealInvitationBusy(true);
    setRealInvitationError('');
    try {
      const response = await api.post(`/api/clients/${encodeURIComponent(demoWorkspaceClient.id)}/invitation`);
      setRealInvitation(response.data.url);
    } catch {
      setRealInvitationError('Could not create this invitation.');
    } finally {
      setRealInvitationBusy(false);
    }
  };
  const [invitationBusy, setInvitationBusy] = useState(false);
  const [invitationError, setInvitationError] = useState('');
  const [clientDraft, setClientDraft] = useState('');
  const [clientDrafts, setClientDrafts] = useState<Array<{ id: string; caption: string; createdAt: number }>>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [clientConnections, setClientConnections] = useState<Record<string, boolean>>({});
  const [connectionMessage, setConnectionMessage] = useState('');
  const loadClientConnections = async (clientId: string) => {
    setConnectionMessage('');
    try {
      const response = await api.get(`/api/clients/${encodeURIComponent(clientId)}/connections`);
      setClientConnections(response.data.connections || {});
    } catch {
      setClientConnections({});
      setConnectionMessage('Could not check client connections. Try reopening this workspace.');
    }
  };
  const loadClientDrafts = async (clientId: string) => {
    try {
      const response = await api.get(`/api/clients/${encodeURIComponent(clientId)}/drafts`);
      setClientDrafts(response.data.drafts || []);
    } catch {
      setDraftMessage('Could not load client drafts.');
    }
  };
  const saveClientDraft = async () => {
    if (!demoWorkspaceClient || !clientDraft.trim() || draftBusy) return;
    setDraftBusy(true);
    setDraftMessage('');
    try {
      await api.post(`/api/clients/${encodeURIComponent(demoWorkspaceClient.id)}/drafts`, { caption: clientDraft });
      setClientDraft('');
      setDraftMessage('Draft saved to this client only. Nothing was published.');
      await loadClientDrafts(demoWorkspaceClient.id);
    } catch {
      setDraftMessage('Could not save client draft.');
    } finally {
      setDraftBusy(false);
    }
  };
  const prepareInvitationPreview = async () => {
    if (!demoWorkspaceClient || invitationBusy) return;
    setInvitationBusy(true);
    setInvitationError('');
    try {
      const response = await api.post(`/api/clients/${encodeURIComponent(demoWorkspaceClient.id)}/invitation-preview`);
      setInvitationPreview(response.data.url);
    } catch {
      setInvitationError('Could not prepare invitation preview. Please try again.');
    } finally {
      setInvitationBusy(false);
    }
  };
  const field = (key: keyof typeof form, label: string, type = 'text') => (
    <label className="block text-sm font-medium text-slate-600">{label}<input type={type} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-amber-500" /></label>
  );
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold">Clients & Businesses</h2><p className="mt-1 text-sm text-slate-500">Keep each client's business details and working notes organised in your private workspace.</p></div><button onClick={() => { setEditingClient(null); setForm({ businessName: '', contactName: '', email: '', phone: '', notes: '', status: 'Active' }); setFormOpen(true); }} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">+ Add client</button></div>
      {formOpen && <div className="mb-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h3 className="font-bold">{editingClient ? 'Edit client' : 'New client'}</h3><button onClick={() => setFormOpen(false)} className="text-sm text-slate-500">Close</button></div><div className="grid gap-4 md:grid-cols-2">{field('businessName', 'Business name *')}{field('contactName', 'Contact person')}{field('email', 'Email address', 'email')}{field('phone', 'Phone / WhatsApp')}</div><label className="mt-4 block text-sm font-medium text-slate-600">Notes<textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Services, preferences, important details…" /></label><div className="mt-4 flex justify-end gap-2"><button onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm">Cancel</button><button onClick={onSave} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950">Save client</button></div></div>}
      {clients.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><Building2 className="mx-auto mb-3 text-slate-400" size={30}/><h3 className="font-bold">No clients added yet</h3><p className="mt-1 text-sm text-slate-500">Add your first business to start organising client work.</p></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{clients.map(client => <article key={client.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-2"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-amber-400"><Building2 size={19}/></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{client.status || 'Active'}</span></div><h3 className="mt-4 font-bold">{client.businessName}</h3>{client.contactName && <p className="mt-1 text-sm text-slate-500">{client.contactName}</p>}{client.email && <p className="mt-3 text-sm text-slate-600">{client.email}</p>}{client.phone && <p className="text-sm text-slate-600">{client.phone}</p>}{client.notes && <p className="mt-3 line-clamp-3 text-sm text-slate-500">{client.notes}</p>}<div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-3"><button onClick={() => onEdit(client)} className="text-sm font-semibold text-slate-700">Edit details</button><button onClick={() => { setDemoWorkspaceClient({ id: client.id, businessName: client.businessName }); setDemoChecklistOpen(false); setInvitationPreview(''); setInvitationError(''); setRealInvitation(''); setRealInvitationError(''); setClientDraft(''); setClientDrafts([]); setDraftMessage(''); setClientConnections({}); void loadClientDrafts(client.id); void loadClientConnections(client.id); }} className="text-sm font-semibold text-amber-700">Client workspace</button><button onClick={() => onDelete(client.id)} className="ml-auto text-sm font-semibold text-rose-600">Delete</button></div></article>)}</div>}
      <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Each business has its own workspace. Client account authorization and automatic publishing are not enabled yet; your Rene VA Services publishing remains separate.</p>
      {demoWorkspaceClient && <section className="mt-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-wider text-amber-700">Client workspace · connection pending</p><h3 className="mt-1 text-xl font-bold">{demoWorkspaceClient.businessName}</h3><p className="mt-1 text-sm text-slate-500">This business is registered in your workspace. Secure client authorization must be completed before scheduling or publishing for this business.</p></div>
          <button onClick={() => setDemoWorkspaceClient(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Close</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {platforms.map(({ name, icon: Icon }) => <div key={name} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2"><Icon size={18}/><span className="font-semibold">{name}</span></div>
            <span className="mt-3 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{clientConnections[name] ? 'Connected · publishing disabled' : 'Not connected'}</span>
            <p className="mt-2 text-xs leading-5 text-slate-500">Client authorization pending. Publishing is disabled for this business until its own account is connected.</p>
          </div>)}
        </div>
        {connectionMessage && <p role="alert" className="mt-3 text-sm text-rose-700">{connectionMessage}</p>}
        <button type="button" onClick={() => void loadClientConnections(demoWorkspaceClient.id)} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">Refresh client connection status</button>
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Automatic publishing: not enabled for this client.</strong><p className="mt-1">A secure client connection link will be available once separate account authorization is implemented and tested. Do not use your own connected accounts for client posts.</p></div>
        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <h4 className="font-semibold">Client content drafts</h4>
          <p className="mt-1 text-sm text-slate-600">Prepare content for this business separately. Drafts are private and will not publish automatically.</p>
          <textarea aria-label="Client post draft" rows={3} maxLength={5000} value={clientDraft} onChange={event => setClientDraft(event.target.value)} placeholder="Write a post for this client…" className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-sm" />
          <button type="button" disabled={draftBusy || !clientDraft.trim()} onClick={saveClientDraft} className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{draftBusy ? 'Saving…' : 'Save client draft'}</button>
          {draftMessage && <p role="status" className="mt-2 text-sm text-slate-600">{draftMessage}</p>}
          <div className="mt-3 space-y-2">{clientDrafts.map(draft => <div key={draft.id} className="rounded-lg bg-slate-50 p-3 text-sm"><span className="font-semibold text-amber-800">Draft · not published</span><p className="mt-1 whitespace-pre-wrap break-words">{draft.caption}</p></div>)}</div>
        </div>
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h4 className="font-semibold">Client Facebook &amp; Instagram invitation · testing</h4>
          <p className="mt-1 text-sm text-slate-700">Create a private 24-hour authorization link. First configure the client Facebook callback URL in Meta and test with an approved test account. Do not send to paying clients until tested. Publishing remains disabled.</p>
          <button type="button" disabled={realInvitationBusy} onClick={createRealInvitation} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{realInvitationBusy ? 'Creating…' : 'Create client connection link'}</button>
          {realInvitationError && <p role="alert" className="mt-2 text-sm text-rose-700">{realInvitationError}</p>}
          {realInvitation && <div className="mt-3 break-all rounded-lg bg-white p-3 text-sm"><a className="text-blue-700 underline" href={realInvitation} target="_blank" rel="noreferrer">Open client connection invitation</a><p className="mt-2 text-xs text-slate-600">Test only · 24 hours · Facebook and linked Instagram · no publishing</p></div>}
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <h4 className="font-semibold">Client invitation preview</h4>
          <p className="mt-1 text-sm text-slate-600">Prepare a private, 24-hour preview link to test the invitation page. It cannot connect social accounts. Do not send this to real clients yet.</p>
          <button type="button" disabled={invitationBusy} onClick={prepareInvitationPreview} className="mt-3 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{invitationBusy ? 'Preparing…' : 'Create test invitation link'}</button>
          {invitationError && <p role="alert" className="mt-2 text-sm text-rose-700">{invitationError}</p>}
          {invitationPreview && <div className="mt-3 break-all rounded-lg bg-slate-50 p-3 text-sm"><a className="text-blue-700 underline" href={invitationPreview} target="_blank" rel="noreferrer">Open test invitation preview</a><p className="mt-2 text-xs text-slate-500">Preview only · expires after 24 hours · no client authorization</p></div>}
        </div>
        <button onClick={() => setDemoChecklistOpen(value => !value)} className="mt-5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">{demoChecklistOpen ? 'Hide setup checklist' : 'View connection setup checklist'}</button>
        {demoChecklistOpen && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><p className="font-semibold">When you're ready to connect a real client's accounts:</p><ol className="mt-2 list-decimal space-y-1 pl-5"><li>Confirm the client owns or manages the Facebook Page and professional Instagram account.</li><li>Have the client authorize access through Meta's official login flow.</li><li>Store each authorization against this specific business, not your Rene VA Services profile.</li><li>Verify the selected business and destination before enabling publishing.</li></ol><p className="mt-3 text-xs text-slate-500">This checklist is informational. No connection or publishing action is performed here.</p></div>}
      </section>}
    </section>
  );
}

function App() {
  const [active, setActive] = useState('Dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState([
    'Facebook',
    'Instagram',
    'Threads',
  ]);
  const [toast, setToast] = useState('');
  const [commandText, setCommandText] = useState('');
  const [commandResult, setCommandResult] = useState('');
  const [authUser, setAuthUser] = useState<{ name?: string; email?: string } | null>(null);
  const [connectionState, setConnectionState] = useState<Record<string, { connected: boolean; configured: boolean }>>({});
  const [publishingThreads, setPublishingThreads] = useState(false);
  const [publishingFacebook, setPublishingFacebook] = useState(false);
  const [publishingInstagram, setPublishingInstagram] = useState(false);
  const [instagramImageUrl, setInstagramImageUrl] = useState('');
  const [instagramImagePath, setInstagramImagePath] = useState('');
  const [uploadedMedia, setUploadedMedia] = useState<{ filename: string; url: string; path: string } | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState<Array<{ id: string; caption: string; platforms: string[]; scheduledAt: string; status: string; platformResults?: Record<string, { published?: boolean; id?: string; error?: string }>; lastError?: string; publishedAt?: number }>>([]);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [clients, setClients] = useState<Array<{ id: string; businessName: string; contactName?: string; email?: string; phone?: string; notes?: string; status?: string }>>([]);
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState({ businessName: '', contactName: '', email: '', phone: '', notes: '', status: 'Active' });
  const [dailyTopic, setDailyTopic] = useState('');
  const [dailyContent, setDailyContent] = useState<{ theme: string; facebook: string; instagram: string; threads: string; imageBrief: string } | null>(null);
  const [generatingDailyContent, setGeneratingDailyContent] = useState(false);
  const [generatingDailyImage, setGeneratingDailyImage] = useState(false);
  const [dailyImageUrl, setDailyImageUrl] = useState('');

  useEffect(() => {
    auth.getUser().then(user => {
      setAuthUser(user);
      if (user) api.get('/api/clients').then(response => setClients(response.data?.clients || [])).catch(() => setClients([]));
      if (user) api.get('/api/scheduled-posts').then(response => setScheduledPosts(response.data?.posts || [])).catch(() => setScheduledPosts([]));
      if (user) {
        api.get('/api/oauth/status')
          .then(response => setConnectionState(response.data?.connections || {}))
          .catch(() => setConnectionState({}));
      }
    }).catch(() => setAuthUser(null));

    const query = new URLSearchParams(window.location.search);
    if (query.get('oauth') === 'success' && ['threads', 'facebook'].includes(query.get('provider') || '')) {
      const provider = query.get('provider');
      setToast(provider === 'facebook'
        ? 'Facebook Page connected. Scheduled publishing is available; check the Content Planner for results.'
        : 'Threads connected with a long-lived access token. Scheduled publishing is available in the background.');
      window.history.replaceState({}, '', window.location.pathname);
      auth.getUser().then(user => {
        if (user) api.get('/api/oauth/status').then(response => setConnectionState(response.data?.connections || {})).catch(() => undefined);
      }).catch(() => undefined);
    } else if (query.get('oauth') === 'error' && ['threads', 'facebook'].includes(query.get('provider') || '')) {
      const provider = query.get('provider') || 'threads';
      const reason = query.get('reason');
      if (reason === 'invalid_state') {
        setToast(`${provider === 'facebook' ? 'Facebook' : 'Threads'} authorization expired or could not be verified. Please start a fresh connection.`);
      } else if (reason === 'missing_parameters') {
        setToast('Meta did not return the information needed to finish connecting. Please try again.');
      } else if (reason === 'no_pages') {
        setToast('Facebook authorization succeeded, but no manageable Page was returned. Check the Page and permissions in Meta.');
      } else if (reason === 'token_exchange') {
        setToast(`Meta returned you to Rene Social Hub, but the ${provider === 'facebook' ? 'Facebook' : 'Threads'} token exchange failed. Check the app configuration, then try again.`);
      } else {
        setToast(`${provider === 'facebook' ? 'Facebook' : 'Threads'} connection was not completed. Please start a fresh connection and try again.`);
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnect = async (name: string) => {
    const provider = name === 'Instagram' ? 'facebook' : name.toLowerCase();
    showToast(`Starting secure ${name} connection…`);
    try {
      if (!auth.isSignedIn()) {
        showToast('Please sign in to Rene Social Hub to continue securely.');
        const result = await auth.signIn();
        setAuthUser(result.user);
      }
      const response = await api.get(`/api/oauth/start/${provider}`);
      const url = response.data?.url;
      const validHost = provider === 'threads'
        ? typeof url === 'string' && url.startsWith('https://threads.net/')
        : typeof url === 'string' && url.startsWith('https://www.facebook.com/');
      if (!validHost) {
        showToast(`${name} authorization could not be started. Please check the setup and try again.`);
        return;
      }
      window.location.assign(url);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'popup_blocked') {
        showToast('Your browser blocked the sign-in popup. Allow popups and try again.');
      } else if (code === 'popup_closed') {
        showToast('Sign-in was cancelled. You can try again when ready.');
      } else {
        showToast(`Rene Social Hub could not start ${name} authorization. Check the setup and make sure you are signed in.`);
      }
    }
  };

  const totalFollowers = useMemo(() => '—', []);
  const togglePlatform = (name: string) =>
    setSelectedPlatforms(current =>
      current.includes(name)
        ? current.filter(item => item !== name)
        : [...current, name]
    );

  const nav = [
    { label: 'Dashboard', icon: LayoutDashboard },
    { label: 'Social Command', icon: Send },
    { label: 'Connected Accounts', icon: Settings },
    { label: 'Content Planner', icon: CalendarDays },
    { label: 'Create Post', icon: Plus },
    { label: 'Media Library', icon: Image },
    { label: 'Analytics', icon: BarChart3 },
    { label: 'Content Ideas', icon: Lightbulb },
    { label: 'AI Content Studio', icon: Sparkles },
    { label: 'Clients & Businesses', icon: Building2 },
  ];

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2500);
  };

  return (
    <div className="min-h-screen bg-[#f7f8fc] text-slate-900">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="font-bold tracking-tight">Rene Social Hub</div>
            <div className="text-xs text-slate-400">Rene VA Services</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5">
          {nav.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => setActive(label)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${active === label ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-600 hover:bg-slate-100">
            <Settings size={18} />
            Settings
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute inset-0 bg-slate-950/40"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col bg-white shadow-2xl">
            <div className="flex h-20 items-center justify-between border-b border-slate-100 px-5">
              <div>
                <div className="font-bold tracking-tight">Rene Social Hub</div>
                <div className="text-xs text-slate-400">Rene VA Services</div>
              </div>
              <button type="button" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X size={21} />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {nav.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setActive(label); setMobileMenuOpen(false); }}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${active === label ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </nav>
            <div className="border-t border-slate-100 p-3">
              <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-500">
                <Settings size={18} />
                Settings
              </div>
            </div>
          </aside>
        </div>
      )}

      <main className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(value => !value)}
              className="rounded-lg p-2 lg:hidden"
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                My workspace
              </p>
              <h1 className="text-xl font-bold tracking-tight">{active}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-100">
              <Bell size={19} />
            </button>
            <button
              onClick={() => setComposerOpen(true)}
              className="hidden items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 sm:flex"
            >
              <Plus size={17} />
              Create post
            </button>
            <div className="ml-1 flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-bold">
              R
            </div>
          </div>
        </header>

        <div className="p-5 lg:p-8">
          {active === 'Dashboard' && (
            <>
              <section className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">
                    Good morning, Rene 👋🏻
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Here’s what’s happening across your social platforms.
                  </p>
                </div>
                <button
                  onClick={() => setComposerOpen(true)}
                  className="flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm"
                >
                  <Send size={16} />
                  Quick publish
                </button>
              </section>

              <section className="mb-6 rounded-2xl border border-slate-200 bg-slate-900 p-5 text-white shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                      <Sparkles size={14} /> Social Command
                    </div>
                    <h3 className="mt-2 text-xl font-bold">Tell your hub what to do</h3>
                    <p className="mt-1 text-sm text-slate-300">Try: Plan my VA tip for Facebook, Instagram and Threads.</p>
                  </div>
                  <button onClick={() => setActive('Social Command')} className="flex w-fit items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900">
                    Open command
                    <ChevronRight size={16} />
                  </button>
                </div>
              </section>

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Total followers', totalFollowers, '+8.4%', TrendingUp],
                  ['Reach this month', '18.6K', '+12.7%', TrendingUp],
                  ['Engagement', '6.8%', '+1.2%', TrendingUp],
                  ['Scheduled posts', '12', '3 this week', CalendarDays],
                ].map(([label, value, change, Icon]) => (
                  <div
                    key={label as string}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500">
                        {label as string}
                      </span>
                      <div className="rounded-xl bg-slate-100 p-2">
                        <Icon size={17} />
                      </div>
                    </div>
                    <div className="mt-4 flex items-end gap-2">
                      <span className="text-2xl font-bold">
                        {value as string}
                      </span>
                      <span className="mb-1 text-xs font-semibold text-emerald-600">
                        {change as string}
                      </span>
                    </div>
                  </div>
                ))}
              </section>

              <section className="mt-6 grid gap-6 xl:grid-cols-[1.55fr_1fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h3 className="font-bold">Your platforms</h3>
                      <p className="text-xs text-slate-400">
                        A quick view of your connected channels
                      </p>
                    </div>
                    <button
                      onClick={() => setActive('Connected Accounts')}
                      className="text-xs font-semibold text-slate-600 hover:underline"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {platforms.map(({ name, icon: Icon, followers }) => (
                      <div
                        key={name}
                        className="flex items-center justify-between rounded-xl border border-slate-100 p-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="rounded-xl bg-slate-100 p-2.5">
                            <Icon size={18} />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{name}</div>
                            <div className="text-xs text-slate-400">
                              {followers} followers
                            </div>
                          </div>
                        </div>
                        <div className="text-xs font-semibold text-emerald-600">
                          +{Math.floor(Math.random() * 8) + 2}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h3 className="font-bold">This week</h3>
                      <p className="text-xs text-slate-400">
                        Publishing activity
                      </p>
                    </div>
                    <BarChart3 size={18} className="text-slate-400" />
                  </div>
                  <div className="flex h-36 items-end justify-between gap-2">
                    {[38, 58, 42, 76, 55, 88, 68].map((height, i) => (
                      <div
                        key={i}
                        className="flex flex-1 flex-col items-center gap-2"
                      >
                        <div
                          className="w-full rounded-t-lg bg-slate-900"
                          style={{ height: `${height}%` }}
                        ></div>
                        <span className="text-[10px] text-slate-400">
                          {['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold">Upcoming content</h3>
                    <p className="text-xs text-slate-400">
                      Your next scheduled posts
                    </p>
                  </div>
                  <button
                    onClick={() => setActive('Content Planner')}
                    className="flex items-center gap-1 text-xs font-semibold"
                  >
                    View planner <ChevronRight size={15} />
                  </button>
                </div>
                <div className="space-y-3">
                  {scheduledPosts.filter(post => post.status === 'Scheduled').slice(0, 4).map(post => (
                    <div key={post.id} className="flex items-center gap-4 rounded-xl border border-slate-100 p-3">
                      <div className="hidden w-12 rounded-lg bg-slate-100 py-2 text-center sm:block">
                        <div className="text-[10px] font-bold text-slate-400">{new Date(post.scheduledAt).toLocaleDateString([], { month: 'short' })}</div>
                        <div className="text-lg font-bold">{new Date(post.scheduledAt).getDate()}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{post.caption}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">{post.platforms.map(platform => <span key={platform} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{platform}</span>)}</div>
                      </div>
                      <div className="text-xs font-semibold text-slate-500">{new Date(post.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  ))}
                  {scheduledPosts.filter(post => post.status === 'Scheduled').length === 0 && <p className="text-sm text-slate-400">No posts scheduled yet. Your saved posts will appear here.</p>}
                </div>
              </section>
            </>
          )}

          {active === 'Clients & Businesses' && (
            <ClientsWorkspace
              clients={clients}
              form={clientForm}
              setForm={setClientForm}
              formOpen={clientFormOpen}
              setFormOpen={setClientFormOpen}
              editingClient={editingClient}
              setEditingClient={setEditingClient}
              onSave={async () => {
                if (!clientForm.businessName.trim()) { showToast('Enter the business name first.'); return; }
                try {
                  if (editingClient) {
                    await api.put(`/api/clients/${editingClient}`, clientForm);
                    setClients(current => current.map(client => client.id === editingClient ? { ...client, ...clientForm } : client));
                    showToast('Client details updated.');
                  } else {
                    const response = await api.post('/api/clients', clientForm);
                    setClients(current => [response.data.client, ...current]);
                    showToast('Client added successfully.');
                  }
                  setClientFormOpen(false);
                  setEditingClient(null);
                  setClientForm({ businessName: '', contactName: '', email: '', phone: '', notes: '', status: 'Active' });
                } catch (err) { showToast((err as { message?: string })?.message || 'Could not save this client.'); }
              }}
              onEdit={client => { setEditingClient(client.id); setClientForm({ businessName: client.businessName, contactName: client.contactName || '', email: client.email || '', phone: client.phone || '', notes: client.notes || '', status: client.status || 'Active' }); setClientFormOpen(true); }}
              onDelete={async id => {
                if (!window.confirm('Delete this client record? This will not delete any social media account.')) return;
                try { await api.delete(`/api/clients/${id}`); setClients(current => current.filter(client => client.id !== id)); showToast('Client record deleted.'); }
                catch (err) { showToast((err as { message?: string })?.message || 'Could not delete this client.'); }
              }}
            />
          )}
          {active === 'Social Command' && (
            <SocialCommand
              commandText={commandText}
              setCommandText={setCommandText}
              result={commandResult}
              onRun={() => {
                if (!commandText.trim()) {
                  setCommandResult('Tell me what you want to schedule first.');
                  return;
                }
                setCommandResult('Plan created: I would prepare platform-specific versions, add the selected channels to your planner, and leave publishing ready for account authorization.');
              }}
              onUsePlanner={() => setActive('Content Planner')}
            />
          )}
          {active === 'Connected Accounts' && (
            <ConnectedAccounts authUser={authUser} connectionState={connectionState} onConnect={handleConnect} />
          )}
          {active === 'Content Planner' && (
            <Planner posts={scheduledPosts} onCreate={() => setComposerOpen(true)} onRefresh={async () => {
              try {
                const response = await api.get('/api/scheduled-posts');
                setScheduledPosts(response.data?.posts || []);
                showToast('Planner refreshed.');
              } catch (err) {
                showToast((err as { message?: string })?.message || 'Could not refresh the planner.');
              }
            }} onCancel={async id => {
              try { await api.delete(`/api/scheduled-posts/${id}`); setScheduledPosts(current => current.map(post => post.id === id ? { ...post, status: 'Cancelled' } : post)); showToast('Scheduled post cancelled.'); }
              catch (err) { showToast((err as { message?: string })?.message || 'Could not cancel this post.'); }
            }} />
          )}
          {active === 'Create Post' && (
            <Composer
              caption={caption}
              setCaption={setCaption}
              selectedPlatforms={selectedPlatforms}
              togglePlatform={togglePlatform}
              onClose={() => setActive('Dashboard')}
              onPublish={() => {
                if (!caption.trim()) { showToast('Write your post first.'); return; }
                if (!selectedPlatforms.length) { showToast('Select at least one platform.'); return; }
                setComposerOpen(true);
              }}
              onPublishFacebook={async () => {
                if (!caption.trim()) {
                  showToast('Write your Facebook post first.');
                  return;
                }
                if (!selectedPlatforms.includes('Facebook')) {
                  showToast('Select Facebook before publishing there.');
                  return;
                }
                if (!connectionState.facebook?.connected) {
                  showToast('Connect your Facebook Page before publishing.');
                  return;
                }
                if (!window.confirm('Publish this post to your connected Facebook Page now?')) return;
                setPublishingFacebook(true);
                try {
                  const response = await api.post('/api/facebook/publish', { message: caption.trim() });
                  if (response.data?.published && response.data?.postId) {
                    showToast('Your post was published to Facebook successfully.');
                    setCaption('');
                  } else {
                    showToast('Facebook did not confirm publication. Please check your Page before retrying.');
                  }
                } catch (err) {
                  const message = (err as { message?: string })?.message;
                  showToast(message || 'Facebook could not publish this post. Please check your Page connection and try again.');
                } finally {
                  setPublishingFacebook(false);
                }
              }}
              publishingFacebook={publishingFacebook}
              instagramImageUrl={instagramImageUrl}
              setInstagramImageUrl={setInstagramImageUrl}
              onPublishInstagram={async () => {
                if (!caption.trim()) { showToast('Write your Instagram caption first.'); return; }
                if (!selectedPlatforms.includes('Instagram')) { showToast('Select Instagram before publishing there.'); return; }
                if (!connectionState.instagram?.connected) { showToast('Reconnect Facebook and approve Instagram access first.'); return; }
                if (!instagramImageUrl.trim()) { showToast('Add a public HTTPS image URL first.'); return; }
                if (!window.confirm('Publish this photo and caption to your linked Instagram professional account now?')) return;
                setPublishingInstagram(true);
                try {
                  const response = await api.post('/api/instagram/publish', { caption: caption.trim(), imageUrl: instagramImageUrl.trim() });
                  if (response.data?.published && response.data?.mediaId) {
                    showToast('Your photo was published to Instagram successfully.');
                    setCaption('');
                    setInstagramImageUrl('');
                  } else showToast('Instagram did not confirm publication. Check your profile before retrying.');
                } catch (err) {
                  showToast((err as { message?: string })?.message || 'Instagram could not publish this photo. Check the image URL and account connection.');
                } finally { setPublishingInstagram(false); }
              }}
              publishingInstagram={publishingInstagram}
              onPublishThreads={async () => {
                if (!caption.trim()) {
                  showToast('Write your Threads post first.');
                  return;
                }
                if (!selectedPlatforms.includes('Threads')) {
                  showToast('Select Threads before publishing there.');
                  return;
                }
                if (!window.confirm('Publish this text post to your connected Threads account now?')) return;
                setPublishingThreads(true);
                try {
                  const response = await api.post('/api/threads/publish', { text: caption.trim() });
                  if (response.data?.published && response.data?.mediaId) {
                    showToast('Your post was published to Threads successfully.');
                    setCaption('');
                  } else {
                    showToast('Threads did not confirm publication. Please check your account before retrying.');
                  }
                } catch (err) {
                  const message = (err as { message?: string })?.message;
                  showToast(message || 'Threads could not publish this post. Please check your connection and try again.');
                } finally {
                  setPublishingThreads(false);
                }
              }}
              publishingThreads={publishingThreads}
            />
          )}
          {active === 'Media Library' && (
            <Library
              uploadedMedia={uploadedMedia}
              uploading={uploadingMedia}
              onUpload={async (file) => {
                const currentUser = await auth.getUser().catch(() => null);
                if (!currentUser) {
                  showToast('Your sign-in session could not be restored. Please sign in again.');
                  try { await auth.signInWithRedirect(); } catch { showToast('Sign-in could not be opened. Please try again.'); }
                  return;
                }
                if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { showToast('Please choose a JPG, PNG or WebP image.'); return; }
                if (file.size > 8 * 1024 * 1024) { showToast('Please choose an image smaller than 8 MB.'); return; }
                setUploadingMedia(true);
                try {
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  let binary = '';
                  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                  const response = await api.post('/api/media/upload', { filename: file.name, contentType: file.type, base64: btoa(binary) });
                  const media = { filename: response.data.filename || file.name, url: response.data.url, path: response.data.path };
                  setUploadedMedia(media);
                  setInstagramImageUrl(media.url);
                  setInstagramImagePath(media.path);
                  showToast('Image uploaded. It is ready for your Instagram post.');
                } catch (err) {
                  showToast((err as { message?: string })?.message || 'The image could not be uploaded. Please try again.');
                } finally { setUploadingMedia(false); }
              }}
              onUse={() => { setInstagramImageUrl(uploadedMedia?.url || ''); setInstagramImagePath(uploadedMedia?.path || ''); setActive('Create Post'); showToast('Image added to your Instagram post.'); }}
            />
          )}
          {active === 'Analytics' && <Analytics />}
          {active === 'AI Content Studio' && (
            <section className="mx-auto max-w-5xl">
              <div className="mb-6 rounded-2xl bg-slate-900 p-6 text-white">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300"><Sparkles size={15}/> Rene VA Services · AI writer</div>
                <h2 className="mt-2 text-2xl font-bold">Your daily content studio</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Generate a fresh post and get platform-ready versions for Facebook, Instagram and Threads. This creates drafts only; it does not publish or schedule them.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <label className="block text-sm font-semibold text-slate-700">Optional topic or angle
                  <input value={dailyTopic} onChange={event => setDailyTopic(event.target.value)} placeholder="e.g. keeping client paperwork organised" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-amber-500" />
                </label>
                <button disabled={generatingDailyContent} onClick={async () => {
                  if (!auth.isSignedIn()) { showToast('Please sign in to generate content securely.'); return; }
                  setGeneratingDailyContent(true);
                  try {
                    const response = await api.post('/api/ai/daily-content', { topic: dailyTopic });
                    setDailyContent(response.data?.content || null);
                    if (!response.data?.content) showToast('No draft was returned. Please try again.');
                  } catch (err) {
                    showToast((err as { message?: string })?.message || 'AI content generation failed. Please try again.');
                  } finally { setGeneratingDailyContent(false); }
                }} className="mt-4 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-50">{generatingDailyContent ? 'Creating your content…' : 'Generate today’s content'}</button>
              </div>
              {dailyContent && <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-amber-800">Today's theme</p><p className="mt-1 font-semibold text-slate-900">{dailyContent.theme}</p></div>
                {([{name:'Facebook',text:dailyContent.facebook},{name:'Instagram',text:dailyContent.instagram},{name:'Threads',text:dailyContent.threads}] as const).map(post => <article key={post.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><h3 className="font-bold">{post.name}</h3><button onClick={() => { setCaption(post.text); setSelectedPlatforms([post.name]); setActive('Create Post'); }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Use in Create Post</button></div><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.text}</p></article>)}
                <div className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-bold">Create your branded image</h3><p className="mt-2 text-sm leading-6 text-slate-600">{dailyContent.imageBrief}</p><button disabled={generatingDailyImage} onClick={async () => { setGeneratingDailyImage(true); setDailyImageUrl(''); try { const response = await api.post('/api/ai/generate-image', { imageBrief: dailyContent.imageBrief, theme: dailyContent.theme }); const url = response.data?.imageUrl || ''; if (!url) throw new Error('No image link was returned.'); setDailyImageUrl(url); setInstagramImageUrl(url); showToast('Your branded image is ready. Use it in Create Post soon; its secure link expires after 15 minutes.'); } catch (err) { showToast((err as { message?: string })?.message || 'Could not generate the image. Please try again.'); } finally { setGeneratingDailyImage(false); } }} className="mt-4 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-50">{generatingDailyImage ? 'Creating your image…' : 'Generate branded image'}</button>{dailyImageUrl && <div className="mt-4"><img src={dailyImageUrl} alt="Generated Rene VA Services social media graphic" className="w-full max-w-md rounded-xl border border-slate-200"/><button onClick={() => { setCaption(dailyContent.instagram); setSelectedPlatforms(['Instagram']); setActive('Create Post'); }} className="mt-3 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Use image and Instagram caption in Create Post</button><p className="mt-2 text-xs text-slate-500">The secure image link expires after 15 minutes. Publish soon after generating it.</p></div>}</div>
              </div>}
            </section>
          )}
          {active === 'Content Ideas' && (
            <Ideas
              onUse={idea => {
                setCaption(idea);
                setComposerOpen(true);
              }}
            />
          )}
        </div>
      </main>

      {composerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6">
          <div className="w-full max-w-2xl rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Create a post</h2>
                <p className="text-xs text-slate-400">
                  Write once for Facebook, Instagram and Threads. Publishing is not active until accounts are authorized.
                </p>
              </div>
              <button
                onClick={() => setComposerOpen(false)}
                className="rounded-xl p-2 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="What do you want to share today?"
              className="h-32 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-slate-400"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {platforms.map(({ name, icon: Icon }) => (
                <button
                  key={name}
                  onClick={() => togglePlatform(name)}
                  className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${selectedPlatforms.includes(name) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'}`}
                >
                  <Icon size={14} />
                  {name}
                </button>
              ))}
            </div>
            {selectedPlatforms.includes('Instagram') && <label className="mt-4 block text-xs font-semibold text-slate-600">Instagram image link (public HTTPS, must remain available until posting)<input value={instagramImageUrl} onChange={event => setInstagramImageUrl(event.target.value)} placeholder="https://…" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal" /></label>}
            <label className="mt-4 block text-xs font-semibold text-slate-600">Choose when this post should go out<input type="datetime-local" value={scheduleDateTime} min={new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16)} onChange={event => setScheduleDateTime(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setComposerOpen(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setComposerOpen(false);
                  showToast('Draft saved.');
                }}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold"
              >
                Save draft
              </button>
              <button
                disabled={savingSchedule}
                onClick={async () => {
                  if (!caption.trim()) { showToast('Write your post first.'); return; }
                  if (!selectedPlatforms.length) { showToast('Select at least one platform.'); return; }
                  if (!scheduleDateTime || new Date(scheduleDateTime).getTime() <= Date.now()) { showToast('Choose a future date and time.'); return; }
                  if (selectedPlatforms.includes('Instagram') && !instagramImageUrl.trim()) { showToast('Instagram needs a permanent public HTTPS image link.'); return; }
                  setSavingSchedule(true);
                  try {
                    const response = await api.post('/api/scheduled-posts', { caption: caption.trim(), platforms: selectedPlatforms, scheduledAt: new Date(scheduleDateTime).toISOString(), imageUrl: instagramImageUrl.trim(), imagePath: instagramImagePath });
                    setScheduledPosts(current => [...current, response.data.post].sort((a,b) => a.scheduledAt.localeCompare(b.scheduledAt)));
                    setComposerOpen(false);
                    setCaption('');
                    setScheduleDateTime('');
                    setActive('Content Planner');
                    const latest = await api.get('/api/scheduled-posts');
                    setScheduledPosts(latest.data?.posts || []);
                    showToast('Post scheduled and added to Content Planner.');
                  } catch (err) { showToast((err as { message?: string })?.message || 'Your post could not be scheduled.'); }
                  finally { setSavingSchedule(false); }
                }}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingSchedule ? 'Saving…' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function SocialCommand({
  commandText,
  setCommandText,
  result,
  onRun,
  onUsePlanner,
}: {
  commandText: string;
  setCommandText: (v: string) => void;
  result: string;
  onRun: () => void;
  onUsePlanner: () => void;
}) {
  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          <Sparkles size={14} /> Social Command
        </div>
        <h2 className="text-2xl font-bold">Run your social media from one command</h2>
        <p className="mt-1 text-sm text-slate-500">Describe the post, timing, and platforms. Rene Social Hub turns it into a clear publishing plan.</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <textarea
          value={commandText}
          onChange={e => setCommandText(e.target.value)}
          placeholder="Plan a post for Facebook, Instagram and Threads."
          className="h-36 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-slate-400"
        />
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
          {['Schedule a post', 'Create a platform-specific version', 'Plan a week of content'].map(example => (
            <button key={example} onClick={() => setCommandText(example)} className="rounded-full border border-slate-200 px-3 py-2 hover:bg-slate-50">
              {example}
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">Use the Content Planner to schedule posts for your connected accounts.</p>
          <button onClick={onRun} className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">
            <Send size={16} /> Build my plan
          </button>
        </div>
        {result && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold">Your plan</div>
            <p className="mt-1 text-sm leading-6 text-slate-600">{result}</p>
            <button onClick={onUsePlanner} className="mt-3 text-xs font-bold text-slate-700 hover:underline">Open planner →</button>
          </div>
        )}
      </div>
    </section>
  );
}

function ConnectedAccounts({
  authUser,
  connectionState,
  onConnect,
}: {
  authUser: { name?: string; email?: string } | null;
  connectionState: Record<string, { connected: boolean; configured: boolean }>;
  onConnect: (name: string) => void;
}) {
  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Account centre</div>
        <h2 className="text-2xl font-bold">Connect your social accounts</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Manage Facebook, Instagram and Threads in one place. Once authorized, scheduled posts are handled by the background publisher and their results appear in Content Planner.
        </p>
      </div>
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-slate-100 p-2.5"><Settings size={18} /></div>
          <div>
            <h3 className="font-bold">Secure connection setup</h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
              {authUser ? `Signed in as ${authUser.name || authUser.email || 'your AppDeploy account'}.` : 'Your AppDeploy sign-in is separate from your social accounts.'} Official Meta authorization keeps account access secure. Scheduled posts are published by the background worker, with each platform result shown in Content Planner.
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {platforms.map(({ name, icon: Icon, followers }) => (
          <div key={name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-slate-100 p-3"><Icon size={20} /></div>
                <div>
                  <h3 className="font-semibold">{name}</h3>
                  <p className="text-xs text-slate-400">{followers} demo followers in the workspace</p>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${connectionState[name.toLowerCase()]?.connected ? 'bg-emerald-50 text-emerald-700' : connectionState[name.toLowerCase()]?.configured ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                {connectionState[name.toLowerCase()]?.connected ? 'Connected' : connectionState[name.toLowerCase()]?.configured ? 'Ready to connect' : 'Setup required'}
              </span>
            </div>
            <button
              onClick={() => onConnect(name)}
              disabled={name === 'Facebook' && connectionState.facebook?.connected === true}
              className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:cursor-default disabled:bg-slate-50 disabled:text-slate-400"
            >
              {connectionState[name.toLowerCase()]?.connected ? (name === 'Instagram' ? 'Refresh Instagram access' : 'Account connected') : connectionState[name.toLowerCase()]?.configured ? (name === 'Instagram' ? 'Connect via Facebook' : 'Connect account') : 'Connection setup needed'}
            </button>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs leading-5 text-slate-400">Instagram connects through the Facebook Page that is linked to your professional Instagram account. Use Refresh Instagram access to re-authorize the Page and approve Instagram permissions. No social passwords or API secrets should be pasted into this app or chat.</p>
    </section>
  );
}

function Planner({ posts, onCreate, onCancel, onRefresh }: {
  posts: Array<{
    id: string;
    caption: string;
    platforms: string[];
    scheduledAt: string;
    status: string;
    platformResults?: Record<string, { published?: boolean; id?: string; error?: string }>;
    lastError?: string;
    publishedAt?: number;
  }>;
  onCreate: () => void;
  onCancel: (id: string) => void;
  onRefresh: () => void;
}) {
  const [selectedPost, setSelectedPost] = useState<typeof posts[number] | null>(null);
  const upcomingDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + index);
    return date;
  });
  const statusTone = (status: string) => status === 'Published'
    ? 'bg-emerald-50 text-emerald-700'
    : status === 'Needs review'
      ? 'bg-amber-50 text-amber-800'
      : status === 'Cancelled'
        ? 'bg-slate-100 text-slate-500'
        : 'bg-blue-50 text-blue-700';
  return (
    <section>
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold">Content planner</h2>
          <p className="text-sm text-slate-500">Your saved posts for Facebook, Instagram and Threads.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onRefresh} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Refresh planner</button>
          <button onClick={onCreate} className="flex w-fit items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
            <Plus size={17} /> New post
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {upcomingDays.map(date => {
          const dayPosts = posts.filter(post => new Date(post.scheduledAt).toDateString() === date.toDateString());
          return (
            <div key={date.toISOString()} className="min-h-44 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-3 text-xs font-bold text-slate-600">{date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
              {dayPosts.length === 0 ? <p className="text-xs text-slate-400">No posts planned</p> : dayPosts.map(post => (
                <article key={post.id} className="mb-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <button onClick={() => setSelectedPost(post)} className="block w-full text-left" aria-label={`Open post details: ${post.caption.slice(0, 60)}`}>
                    <p className="line-clamp-3 text-xs font-semibold text-slate-800">{post.caption}</p>
                    <p className="mt-2 text-[10px] text-slate-500">{new Date(post.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{post.platforms.join(' · ')}</p>
                    <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${statusTone(post.status)}`}>{post.status}</span>
                    <p className="mt-2 text-[10px] font-semibold text-amber-700">View post details →</p>
                  </button>
                  {post.status === 'Scheduled' && <button onClick={() => onCancel(post.id)} className="mt-2 text-[10px] font-semibold text-rose-600">Cancel scheduled post</button>}
                </article>
              ))}
            </div>
          );
        })}
      </div>
      {posts.length === 0 && <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">You haven't scheduled any posts yet. Choose New post to add your first one.</div>}
      <p className="mt-4 text-xs text-slate-500">Automatic publishing runs in the background every five minutes. Refresh this planner to check the latest results.</p>

      {selectedPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setSelectedPost(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="planner-post-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Content planner · post details</p>
                <h3 id="planner-post-title" className="mt-1 text-xl font-bold text-slate-900">Publishing status</h3>
              </div>
              <button onClick={() => setSelectedPost(null)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Close post details"><X size={18}/></button>
            </div>
            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{selectedPost.caption}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{new Date(selectedPost.scheduledAt).toLocaleString()}</span>
                <span>·</span>
                <span>{selectedPost.platforms.join(' · ')}</span>
              </div>
              <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusTone(selectedPost.status)}`}>{selectedPost.status}</span>
            </div>
            <div className="mt-5">
              <h4 className="font-bold text-slate-900">Results by platform</h4>
              <div className="mt-3 space-y-3">
                {selectedPost.platforms.map(platform => {
                  const result = selectedPost.platformResults?.[platform];
                  return (
                    <div key={platform} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800">{platform}</span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${result?.published ? 'bg-emerald-50 text-emerald-700' : result ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                          {result?.published ? 'Published' : result ? 'Not confirmed' : 'No result recorded'}
                        </span>
                      </div>
                      {result?.error && <p className="mt-2 text-sm text-rose-700">{result.error}</p>}
                      {result?.id && <p className="mt-2 break-all text-xs text-slate-500">Publication ID: {result.id}</p>}
                      {!result && <p className="mt-2 text-sm text-slate-500">No publishing confirmation was saved for this platform.</p>}
                    </div>
                  );
                })}
              </div>
            </div>
            {selectedPost.lastError && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">What needs attention</p><p className="mt-1 text-sm text-amber-800">{selectedPost.lastError}</p></div>}
            {selectedPost.publishedAt && <p className="mt-4 text-xs text-slate-500">Confirmed published: {new Date(selectedPost.publishedAt).toLocaleString()}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => { onRefresh(); setSelectedPost(null); }} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Refresh results</button>
              <button onClick={() => setSelectedPost(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Close</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
function Composer({
  caption,
  setCaption,
  selectedPlatforms,
  togglePlatform,
  onClose,
  onPublish,
  onPublishThreads,
  publishingThreads,
  onPublishFacebook,
  publishingFacebook,
  instagramImageUrl,
  setInstagramImageUrl,
  onPublishInstagram,
  publishingInstagram,
}: {
  caption: string;
  setCaption: (v: string) => void;
  selectedPlatforms: string[];
  togglePlatform: (v: string) => void;
  onClose: () => void;
  onPublish: () => void;
  onPublishThreads: () => void;
  publishingThreads: boolean;
  onPublishFacebook: () => void;
  publishingFacebook: boolean;
  instagramImageUrl: string;
  setInstagramImageUrl: (v: string) => void;
  onPublishInstagram: () => void;
  publishingInstagram: boolean;
}) {
  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Create post</h2>
        <p className="text-sm text-slate-500">
          Prepare content for Facebook, Instagram and Threads. Threads text posts can be published now after confirmation.
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="text-sm font-semibold">Your content</label>
        <textarea
          value={caption}
          onChange={e => setCaption(e.target.value)}
          className="mt-2 h-44 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none"
          placeholder="Write your post here..."
        />
        <div className="mt-5">
          <div className="mb-2 text-sm font-semibold">Publish to</div>
          <div className="flex flex-wrap gap-2">
            {platforms.map(({ name, icon: Icon }) => (
              <button
                key={name}
                onClick={() => togglePlatform(name)}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${selectedPlatforms.includes(name) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'}`}
              >
                <Icon size={14} />
                {name}
              </button>
            ))}
          </div>
        </div>
        {selectedPlatforms.includes('Instagram') && (
          <div className="mt-4">
            <label className="text-sm font-semibold">Instagram photo URL (public HTTPS link)</label>
            <input value={instagramImageUrl} onChange={e => setInstagramImageUrl(e.target.value)} placeholder="https://your-public-image-link.jpg" className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-400" />
            <p className="mt-1 text-xs text-slate-400">The image must be publicly accessible online. Private device files and Google Drive preview links will not work.</p>
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500"
          >
            Cancel
          </button>
          <button
            onClick={onPublish}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold"
          >
            Schedule post
          </button>
          <button
            onClick={onPublishFacebook}
            disabled={publishingFacebook}
            className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-semibold text-blue-800 disabled:opacity-50"
          >
            {publishingFacebook ? 'Publishing…' : 'Publish to Facebook'}
          </button>
          <button
            onClick={onPublishInstagram}
            disabled={publishingInstagram}
            className="rounded-xl border border-pink-200 bg-pink-50 px-5 py-2.5 text-sm font-semibold text-pink-800 disabled:opacity-50"
          >
            {publishingInstagram ? 'Publishing…' : 'Publish to Instagram'}
          </button>
          <button
            onClick={onPublishThreads}
            disabled={publishingThreads}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {publishingThreads ? 'Publishing…' : 'Publish to Threads'}
          </button>
        </div>
      </div>
    </section>
  );
}
function Library({ uploadedMedia, uploading, onUpload, onUse }: { uploadedMedia: { filename: string; url: string; path: string } | null; uploading: boolean; onUpload: (file: File) => void; onUse: () => void }) {
  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Media library</h2>
          <p className="text-sm text-slate-500">
            Keep your social media assets organized.
          </p>
        </div>
        <label className={`flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white ${uploading ? 'opacity-60' : ''}`}>
          <Plus size={17} />
          {uploading ? 'Uploading…' : 'Upload image'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ''; }} />
        </label>
      </div>
      {uploadedMedia && <div className="mb-5 max-w-sm rounded-2xl border border-amber-200 bg-white p-4 shadow-sm"><img src={uploadedMedia.url} alt={uploadedMedia.filename} className="aspect-square w-full rounded-xl object-contain bg-slate-50" /><p className="mt-3 truncate text-sm font-semibold">{uploadedMedia.filename}</p><button onClick={onUse} className="mt-3 w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950">Use for Instagram post</button><p className="mt-2 text-xs text-slate-500">Uploaded images are kept in your private app storage. A fresh secure image link is created when a scheduled post is due.</p></div>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {[
          'VA Toolkit',
          'Client tip',
          'Pinterest pin',
          'Behind the scenes',
          'Promo graphic',
          'Reel cover',
          'Course launch',
          'Testimonial',
        ].map(item => (
          <div
            key={item}
            className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex aspect-square items-center justify-center bg-slate-100 text-slate-300">
              <Image size={30} />
            </div>
            <div className="p-3 text-sm font-semibold">{item}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
function Analytics() {
  return (
    <section>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Analytics</h2>
        <p className="text-sm text-slate-500">
          Understand what content is working across your platforms.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['Reach', '18.6K', '+12.7%'],
          ['Engagement', '6.8%', '+1.2%'],
          ['Profile visits', '2,143', '+9.4%'],
        ].map(([a, b, c]) => (
          <div
            key={a}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="text-sm text-slate-500">{a}</div>
            <div className="mt-2 text-3xl font-bold">{b}</div>
            <div className="mt-1 text-xs font-semibold text-emerald-600">
              {c} vs last period
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-bold">Performance by platform</h3>
        <div className="mt-5 space-y-4">
          {platforms.map(({ name, followers }) => (
            <div key={name}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-semibold">{name}</span>
                <span className="text-slate-400">{followers}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-slate-900"
                  style={{ width: `${35 + Math.floor(Math.random() * 55)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
function Ideas({ onUse }: { onUse: (idea: string) => void }) {
  const ideas = [
    '3 things every busy business owner should delegate',
    'A behind-the-scenes look at how I organize a client’s week',
    'Why your social media doesn’t need to be complicated',
    'Quick VA tip: create a weekly content checklist',
    'What I wish every new virtual assistant knew',
  ];
  return (
    <section>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Content ideas</h2>
        <p className="text-sm text-slate-500">
          Fresh prompts for Rene VA Services.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {ideas.map((idea, i) => (
          <div
            key={idea}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
              <Lightbulb size={17} />
            </div>
            <h3 className="font-semibold">{idea}</h3>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Turn this idea into a helpful, authentic post for your audience.
            </p>
            <button
              onClick={() => onUse(idea)}
              className="mt-4 text-xs font-bold text-slate-700 hover:underline"
            >
              Use this idea →
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default App;

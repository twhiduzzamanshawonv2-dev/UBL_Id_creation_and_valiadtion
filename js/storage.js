/**
 * System Storage Layer - Supabase PostgreSQL as the Live Database
 * -----------------------------------------------------------------------
 * Replaces the old Google Sheets/Apps Script backend. All actual queries
 * live in js/db-service.js; this file adapts that service to the shape
 * app.js already expects (keeps `storage.getUsers()`, `storage.addUser()`,
 * etc. as the app's single data-access surface) and holds the small amount
 * of UI-facing state (current page of results, total count, fixed
 * roles/designations).
 *
 * Unlike the old version, the full user list is never loaded into memory -
 * only the current page of the Admin table (`this.users`) is cached, and
 * search/filter/pagination are all pushed down to Supabase (see
 * db-service.js -> getUsers()). This is what makes listing/searching fast
 * regardless of how many users exist.
 */

const FIXED_ROLES = ['BP', 'Supervisor', 'FC'];
const FIXED_DESIGNATIONS = ['BP', 'Supervisor', 'FC'];
const DEFAULT_PAGE_SIZE = 25;

class StorageManager {
  constructor() {
    this.users = [];   // current page only
    this.total = 0;    // total rows matching the current filter set
    this.page = 1;
    this.pageSize = DEFAULT_PAGE_SIZE;
    this.loaded = false;
    this.agencies = [];   // full list, cached (small master data)
    this.campaigns = [];  // full list, cached (small master data)
    this.currentAccount = null; // { role, agencyId, agencyName, campaignId, campaignName, status } - see loadCurrentAccount()
  }

  isConfigured() {
    return !!window.supabaseConfigured;
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  /**
   * Fetches one page of users matching `filters` from Supabase. Called on
   * initial load, on every filter/search change (debounced - see app.js),
   * and on pagination clicks. Does NOT pull the whole table - only
   * `pageSize` rows plus a total count, so this stays fast at any data size.
   */
  async fetchUsers(filters = {}, page = this.page) {
    this.page = page;
    const { rows, total } = await dbService.getUsers({ ...filters, page, pageSize: this.pageSize });
    this.users = rows;
    this.total = total;
    this.loaded = true;
    return this.users;
  }

  // Synchronous accessor to the currently-loaded page - fast, reflects
  // whatever fetchUsers() last returned.
  getUsers() {
    return this.users;
  }

  // Looks up a user within the CURRENTLY LOADED PAGE only (used by row
  // action buttons, which only ever reference rows already on screen).
  getUserById(id) {
    return this.users.find(u => u.id === id) || null;
  }

  // Full record + resolved (signed) NID document URLs, for the User Details
  // modal. Re-fetches from Supabase if the row isn't in the current page
  // cache (e.g. stale reference), so details always reflect live data.
  async getUserDetailWithImages(id) {
    let user = this.getUserById(id);
    if (!user) {
      user = await dbService.getUserByCode(id);
      if (!user) return null;
    }
    return dbService.getSignedDocUrls(user);
  }

  async checkDuplicate(mobile, nid, agencyId, campaignId, excludeId = null) {
    return dbService.checkDuplicate(mobile, nid, agencyId, campaignId, excludeId);
  }

  async getReportToUsers(targetDesignation, agencyId, campaignId, excludeId = null) {
    return dbService.getReportToUsers(targetDesignation, agencyId, campaignId, excludeId);
  }

  /**
   * Creates a user then updates local state directly (prepend to the current
   * page, bump the total) instead of re-fetching the whole list - this is
   * what makes submission feel instant instead of waiting on a full reload.
   */
  async addUser(userData, files) {
    if (typeof calculateAge === 'function' && userData && userData.dob) {
      const age = calculateAge(userData.dob);
      if (age < 18) {
        throw new Error('User must be at least 18 years old to create an account.');
      }
    }

    const savedUser = await dbService.createUser(userData, files);
    if (this.page === 1) {
      this.users = [savedUser, ...this.users].slice(0, this.pageSize);
    }
    this.total += 1;
    return savedUser;
  }

  // Agency/Campaign are not editable (see db-service.js updateUser doc comment) -
  // `agencyId`/`campaignId` here are the user's EXISTING values, read from the
  // already-loaded row by the caller, only used to keep the duplicate-check and
  // Report To lookup correctly scoped.
  async updateUser(id, updatedFields, agencyId, campaignId) {
    const savedUser = await dbService.updateUser(id, updatedFields, agencyId, campaignId);
    const idx = this.users.findIndex(u => u.id === id);
    if (idx !== -1) this.users[idx] = savedUser;
    return savedUser;
  }

  async toggleUserStatus(id) {
    const newStatus = await dbService.toggleUserStatus(id);
    const idx = this.users.findIndex(u => u.id === id);
    if (idx !== -1) this.users[idx].status = newStatus;
    return this.getUserById(id) || { id, status: newStatus };
  }

  getRoles() {
    return [...FIXED_ROLES];
  }

  getDesignations() {
    return [...FIXED_DESIGNATIONS];
  }

  /**
   * Loads the FULL Agency/Campaign lists (including Inactive - admin screens
   * need to see/manage those too) once and caches them - both lists are small
   * master data, so re-fetching on every dropdown population would be wasteful.
   * Called once at app init and again after any Agency/Campaign create/update.
   */
  async loadAgenciesAndCampaigns() {
    const [agencies, campaigns] = await Promise.all([
      dbService.getAgencies(true),
      dbService.getCampaigns(null, true)
    ]);
    this.agencies = agencies;
    this.campaigns = campaigns;
  }

  // Synchronous accessors over the cached lists (same style as getRoles()/getDesignations()).
  getAgencies({ activeOnly = false } = {}) {
    return activeOnly ? this.agencies.filter(a => a.status === 'Active') : [...this.agencies];
  }

  getCampaigns({ agencyId = null, activeOnly = false } = {}) {
    let list = this.campaigns;
    if (agencyId) list = list.filter(c => c.agency_id === agencyId);
    if (activeOnly) list = list.filter(c => c.status === 'Active');
    return [...list];
  }

  getAgencyById(id) {
    return this.agencies.find(a => a.id === id) || null;
  }

  getCampaignById(id) {
    return this.campaigns.find(c => c.id === id) || null;
  }

  async addAgency(name) {
    const created = await dbService.createAgency(name);
    await this.loadAgenciesAndCampaigns();
    return created;
  }

  async updateAgency(id, fields) {
    const updated = await dbService.updateAgency(id, fields);
    await this.loadAgenciesAndCampaigns();
    return updated;
  }

  async deleteAgency(id) {
    await dbService.deleteAgency(id);
    await this.loadAgenciesAndCampaigns();
  }

  async addCampaign(agencyId, name) {
    const created = await dbService.createCampaign(agencyId, name);
    await this.loadAgenciesAndCampaigns();
    return created;
  }

  async updateCampaign(id, fields) {
    const updated = await dbService.updateCampaign(id, fields);
    await this.loadAgenciesAndCampaigns();
    return updated;
  }

  async deleteCampaign(id) {
    await dbService.deleteCampaign(id);
    await this.loadAgenciesAndCampaigns();
  }

  async fetchDashboardCounts(filters = {}) {
    return dbService.getDashboardCounts(filters);
  }

  /**
   * Resolves and caches the current session's account scope. No profile row
   * in the database = legacy Super Admin (mirrors the exact same bootstrap
   * rule enforced server-side by is_super_admin() in supabase/schema.sql -
   * this client-side cache is a convenience for instant UI decisions, never
   * the actual security boundary, which is always the DB's RLS policies).
   *
   * Throws if the account's profile row exists but is Inactive/Suspended -
   * the caller (js/app.js initAuth()) must sign the session out and block
   * entry when this throws; it is the app-layer half of "disabled account ->
   * login blocked" (the DB-layer half is my_agency_id()/my_campaign_id()
   * returning NULL for a non-Active row, so even a leaked/reused session
   * token gets zero data regardless of this check).
   */
  async loadCurrentAccount() {
    const profile = await dbService.getMyAccountProfile();

    if (!profile) {
      this.currentAccount = { role: 'super_admin', agencyId: null, campaignId: null, status: 'Active' };
      return this.currentAccount;
    }

    if (profile.status !== 'Active') {
      this.currentAccount = null;
      throw new Error('Your account has been disabled. Contact your administrator.');
    }

    this.currentAccount = {
      role: profile.role,
      agencyId: profile.agency_id,
      campaignId: profile.campaign_id,
      status: profile.status
    };
    return this.currentAccount;
  }

  clearCurrentAccount() {
    this.currentAccount = null;
  }

  isSuperAdmin() {
    return !!this.currentAccount && this.currentAccount.role === 'super_admin';
  }

  getMyAgencyId() {
    return this.currentAccount ? this.currentAccount.agencyId : null;
  }

  getMyCampaignId() {
    return this.currentAccount ? this.currentAccount.campaignId : null;
  }

  getMyAgencyName() {
    const agency = this.getAgencyById(this.getMyAgencyId());
    return agency ? agency.name : '';
  }

  getMyCampaignName() {
    const campaign = this.getCampaignById(this.getMyCampaignId());
    return campaign ? campaign.name : '';
  }

  async getAllAccountProfiles() {
    return dbService.getAllAccountProfiles();
  }

  async linkAccountProfile(fields) {
    return dbService.linkAccountProfile(fields);
  }

  async updateAccountProfile(id, fields) {
    return dbService.updateAccountProfile(id, fields);
  }
}

const storage = new StorageManager();

if (typeof window !== 'undefined') {
  window.storage = storage;
}

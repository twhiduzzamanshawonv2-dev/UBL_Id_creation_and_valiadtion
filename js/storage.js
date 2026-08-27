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

  async checkDuplicate(mobile, nid, excludeId = null) {
    return dbService.checkDuplicate(mobile, nid, excludeId);
  }

  async getReportToUsers(targetDesignation, excludeId = null) {
    return dbService.getReportToUsers(targetDesignation, excludeId);
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

  async updateUser(id, updatedFields) {
    const savedUser = await dbService.updateUser(id, updatedFields);
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
}

const storage = new StorageManager();

if (typeof window !== 'undefined') {
  window.storage = storage;
}

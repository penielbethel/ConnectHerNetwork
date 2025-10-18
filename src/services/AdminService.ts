import apiService from './ApiService';

class AdminService {
  async generateInvite(role: 'admin' | 'superadmin') {
    return apiService['makeRequest']('/admin/generate-invite', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  }

  async promoteUser(username: string) {
    return apiService['makeRequest'](`/admin/promote/${encodeURIComponent(username)}`, {
      method: 'POST',
    });
  }

  async demoteUser(username: string) {
    return apiService['makeRequest'](`/admin/demote/${encodeURIComponent(username)}`, {
      method: 'POST',
    });
  }

  async listUsers() {
    return apiService['makeRequest']('/admin/users');
  }

  async getAnalytics() {
    return apiService['makeRequest']('/admin/analytics');
  }

  async deleteUser(username: string) {
    // Prefer protected superadmin endpoint; fallback to legacy if missing (404)
    try {
      return await apiService['makeRequest'](`/admin/delete/${encodeURIComponent(username)}`, {
        method: 'DELETE',
      });
    } catch (err: any) {
      const status = (err as any)?.status;
      if (status === 404) {
        // Legacy route on older servers
        return await apiService['makeRequest'](`/delete/${encodeURIComponent(username)}`, {
          method: 'DELETE',
        });
      }
      throw err;
    }
  }
}
// Lazy proxy to avoid import-time construction
const adminService = {
  generateInvite: (role: 'admin' | 'superadmin') => new AdminService().generateInvite(role),
  promoteUser: (username: string) => new AdminService().promoteUser(username),
  demoteUser: (username: string) => new AdminService().demoteUser(username),
  listUsers: () => new AdminService().listUsers(),
  getAnalytics: () => new AdminService().getAnalytics(),
  deleteUser: (username: string) => new AdminService().deleteUser(username),
};
export default adminService;
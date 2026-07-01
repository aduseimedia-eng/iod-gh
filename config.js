// ============================================================
// Configuration File for IOD Ghana Membership Database
// ============================================================

const CONFIG = {
    // API Base URL
    API_BASE_URL: (typeof window !== 'undefined' && window.IOD_API_BASE_URL) || '',
    
    // API Endpoints
    ENDPOINTS: {
        // Members
        GET_ALL_MEMBERS: '/api/members',
        GET_MEMBER: (id) => `/api/members/${id}`,
        CREATE_MEMBER: '/api/members',
        UPDATE_MEMBER: (id) => `/api/members/${id}`,
        DELETE_MEMBER: (id) => `/api/members/${id}`,
        
        // Subscriptions
        GET_MEMBER_SUBSCRIPTIONS: (id) => `/api/members/${id}/subscriptions`,
        ADD_SUBSCRIPTION: (id) => `/api/members/${id}/subscriptions`,
        UPDATE_SUBSCRIPTION: (id) => `/api/subscriptions/${id}`,
        DELETE_SUBSCRIPTION: (id) => `/api/subscriptions/${id}`,
        
        // Reports
        GET_STATISTICS: '/api/statistics/members',
        GET_GOOD_STANDING: (year) => `/api/good-standing/${year}`
    },
    
    // UI Configuration
    UI: {
        ITEMS_PER_PAGE: 10,
        DATE_FORMAT: 'DD/MM/YYYY',
        MEMBER_TYPES: ['AIOD', 'FIOD', 'MIOD', 'Honorary', 'Corporate'],
        REGIONS: [
            'Greater Accra',
            'Ashanti',
            'Western',
            'Western North',
            'Eastern',
            'Central',
            'Northern',
            'North East',
            'Savannah',
            'Volta',
            'Oti',
            'Bono',
            'Bono East',
            'Ahafo',
            'Upper East',
            'Upper West'
        ]
    },
    
    // Helper function to construct full API URLs
    getApiUrl: function(endpoint) {
        if (typeof endpoint === 'function') {
            return this.API_BASE_URL + endpoint;
        }
        return this.API_BASE_URL + endpoint;
    }
};

// Export for use in modules if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}

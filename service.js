const MAIN_API_URL = "https://api.cosmospark.org";

window.addEventListener('load', () => {
    updateHeaderAuth();
    
    const searchForm = document.getElementById('service-search-form');
    if (searchForm) {
        searchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const query = document.getElementById('service-query').value.trim();
            if (!query) return;

            const loadingIndicator = document.getElementById('loading-indicator');
            const resultsContainer = document.getElementById('results-container');
            
            loadingIndicator.style.display = 'block';
            resultsContainer.innerHTML = '';

            try {
                const response = await fetch(`${MAIN_API_URL}/api/search-idealist?q=${encodeURIComponent(query)}`);
                const data = await response.json();

                loadingIndicator.style.display = 'none';

                if (data.success && data.data.length > 0) {
                    data.data.forEach(opportunity => {
                        const card = document.createElement('div');
                        card.className = 'result-card';
                        card.innerHTML = `
                            <h3>${opportunity.title}</h3>
                            <div class="result-org">${opportunity.organization}</div>
                            <div class="result-meta">📍 ${opportunity.location}</div>
                            ${opportunity.posted ? `<div class="result-meta">🕒 ${opportunity.posted}</div>` : ''}
                            <a href="${opportunity.url}" target="_blank" rel="noopener noreferrer" class="result-link">View Opportunity →</a>
                        `;
                        resultsContainer.appendChild(card);
                    });
                } else {
                    resultsContainer.innerHTML = '<p style="text-align: center; grid-column: 1/-1; font-size: 1.2rem;">No opportunities found. Try a different keyword!</p>';
                }
            } catch (error) {
                console.error('Search error:', error);
                loadingIndicator.style.display = 'none';
                resultsContainer.innerHTML = '<p style="text-align: center; grid-column: 1/-1; color: red;">Failed to load results. Please try again.</p>';
            }
        });
    }
});

async function updateHeaderAuth() {
    const token = localStorage.getItem('auth_token');
    const userStr = localStorage.getItem('auth_user');
    const loginBtn = document.getElementById('header-login-btn');
    const greeting = document.getElementById('header-greeting');
    const logoutBtn = document.getElementById('header-logout-btn');

    if (!loginBtn || !greeting || !logoutBtn) return;

    if (token && userStr) {
        const user = JSON.parse(userStr);
        loginBtn.style.display = 'none';
        greeting.style.display = 'inline-block';
        greeting.textContent = `Hi, ${user.username}`;
        logoutBtn.style.display = 'inline-block';
    } else {
        loginBtn.style.display = 'inline-block';
        greeting.style.display = 'none';
        logoutBtn.style.display = 'none';
    }
}

function handleLogout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.location.reload();
}
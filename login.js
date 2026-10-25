const API_URL = "https://communityfriend.onrender.com/"; 

let isLoginMode = true;

const toggleLoginBtn = document.getElementById('toggle-login');
const toggleRegisterBtn = document.getElementById('toggle-register');
const usernameGroup = document.getElementById('username-group');
const submitBtn = document.getElementById('submit-btn');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');

toggleLoginBtn.addEventListener('click', () => {
    if (!isLoginMode) {
        isLoginMode = true;
        toggleLoginBtn.classList.add('active');
        toggleRegisterBtn.classList.remove('active');
        usernameGroup.style.display = 'none';
        submitBtn.textContent = 'Sign In';
        authError.textContent = '';
    }
});

toggleRegisterBtn.addEventListener('click', () => {
    if (isLoginMode) {
        isLoginMode = false;
        toggleRegisterBtn.classList.add('active');
        toggleLoginBtn.classList.remove('active');
        usernameGroup.style.display = 'block';
        submitBtn.textContent = 'Sign Up';
        authError.textContent = '';
    }
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const username = document.getElementById('username').value.trim();
    
    authError.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = isLoginMode ? 'Signing In...' : 'Creating Account...';

    try {
        const endpoint = isLoginMode ? '/api/login' : '/api/register';
        const payload = isLoginMode ? { email, password } : { username, email, password };

        const response = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            window.location.href = 'index.html';
        } else {
            authError.textContent = data.message || 'An error occurred.';
        }
    } catch (error) {
        console.error('Auth error:', error);
        authError.textContent = 'Network error. Please try again.';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isLoginMode ? 'Sign In' : 'Sign Up';
    }
});
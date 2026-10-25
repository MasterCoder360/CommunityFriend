window.addEventListener('load', () => {
    const element1 = document.getElementById('typewriter-text');
    if (element1) {
        const text1 = "This is a beta-version release and it is only available exclusively across Jersey City, New Jersey Events. We are working hard behind the scenes to make new features happen! This project is mainly about getting updates on special events happening around Jersey City so you don't miss out on any important dates. It can also help mark events to put in your calendar and if you don't, that's okay because the website organizes the events for you.";
        let index1 = 0;
        const cursor = element1.querySelector('.cursor');

        function run1() {
            if (index1 < text1.length) {
                const textNode = document.createTextNode(text1.charAt(index1));
                element1.insertBefore(textNode, cursor);
                index1++;
                setTimeout(run1, 30);
            }
        }
        run1();
    }
});
function updateHeaderAuth() {
    const userStr = localStorage.getItem('user');
    const loginBtn = document.getElementById('header-login-btn');
    const greeting = document.getElementById('header-greeting');
    const logoutBtn = document.getElementById('header-logout-btn');

    if (userStr) {
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
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    updateHeaderAuth();
    window.location.reload();
}

window.addEventListener('load', updateHeaderAuth);
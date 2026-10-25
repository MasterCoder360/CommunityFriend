window.addEventListener('load', () => { 
    const element1 = document.getElementById('typewriter-text'); 
    if (element1) { 
        const text1 = "This is a beta-version release and it is only availible exclusively across Jersey City, New Jersey Events. We are working hard behind the scenes to make new features happen! This project is mainly about getting updates on special events happeining around Jersey City so you don't miss out on any important dates. It can also help mark events to put in your calender and if you don't, that's okay because the website organzizes the events for you."; 
        let index1 = 0; 
        function run1() { 
            if (index1 < text1.length) { 
                element1.innerHTML += text1.charAt(index1); 
                index1++; 
                setTimeout(run1, 40); 
            } 
        } 
        run1(); 
    } 
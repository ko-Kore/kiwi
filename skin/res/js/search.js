
window.addEventListener('load', function() {
    var gotoResult = document.querySelector('#goto-result');
    var searchResult = document.querySelector('#search-result');
    var searchString = decodeURIComponent(new URL(location.href).searchParams.get('search') || '');
    goto(searchString, function(url) {
        gotoResult.innerHTML = '<h2>文書名 一致: <a href="' + url + '">' + searchString + '</a><h2>';
    })
    search(searchString, function(data) {
        var word = data.word;
        for(entry of data.pages) {
            var title = entry.title
            var url = pagesUrl + '/' + title + pageExtension;
            var surrounding = entry.surrounding;

            var index = surrounding.indexOf(word);
            surrounding =
                    surrounding.substring(0, index)
                    + '<span class="bold">'
                    + word
                    + '</span>'
                    + surrounding.substring(index + word.length);
            
            var div = document.createElement('div');
            div.classList.add('result-entry')
            div.innerHTML =
                    '<h3 class="title">'
                    + '<a href="' + url + '">'
                    + title + '</a></h3>'
                    + '<p class="surrounding">'
                    + surrounding + '</p>'
            searchResult.appendChild(div);
        }
    });
});

function goto(searchString, callback) {
    var url = pagesUrl + '/' + searchString + pageExtension;
    console.log(url);
    var request = new XMLHttpRequest();
    request.onreadystatechange = function() {
        if(request.readyState === XMLHttpRequest.DONE && request.status === 200) {
            callback(url);
        }
    };
    request.open("GET", url)
    request.send(null);
}

function search(searchString, callback) {
    var request = new XMLHttpRequest();
    request.onreadystatechange = function() {
        if(request.readyState === XMLHttpRequest.DONE && request.status === 200) {
            var data = JSON.parse(request.responseText);
            callback(data);
        }
    };
    request.open("GET", indicesUrl + '/' + searchString + '.json')
    request.send(null);
}

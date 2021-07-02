var sparqlEndpoint = "https://query.wikidata.org/sparql";
var wikidataEndpoint = "https://www.wikidata.org/w/api.php?"
var wikipediaEndpoint = "https://en.wikipedia.org/w/api.php?"

//Query the wikidata sparql endpoint for data on chemical elements
function querySparql(){
  var params = "origin=*&format=json&query=";
  var query = `
SELECT ?element ?elementLabel ?esymbol ?anum ?dateOfDiscovery  
        ?inventor ?inventorLabel ?inventordesc
        ?commons ?picture 
WHERE {
    ?element wdt:P31 wd:Q11344;
             wdt:P246 ?esymbol;
    optional { ?element wdt:P575 ?dateOfDiscovery. }
    optional { ?element wdt:P61  ?inventor. 
               ?inventor schema:description ?inventordesc FILTER(LANG(?inventordesc) = "en").  
             }
    optional { ?element wdt:P1086 ?anum.}
    optional { ?element wdt:P935 ?commons.}
    optional { ?element wdt:P18 ?picture. }
  
    SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
    FILTER (?anum <= 118) #Elements over this are currently only theoretical
}
LIMIT 30
`;
  
  const options = {
      method: 'POST',
      body: encodeURI(params+query),
      headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
      }
  }

  return fetch(sparqlEndpoint, options)
    .then(function(response){      
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(function(response) {
          return parseElements(response);
     })
    .catch(error=>{
      console.log(error);
    });
}

function parseElements(sparql_json){
  var queryVars = sparql_json.head.vars;
  var json_elements = sparql_json.results.bindings;
  var elements = {}; 

  json_elements.forEach(function(e){
    var new_element = {};
    queryVars.forEach(function(v){
      if (e[v]){
        new_element[v] = e[v].value;
      }
    });
    elements[new_element.anum]=new_element;
  })
  return elements;
}

//Get the title and URL of the wikipedia page corresponding to the wikidata element QID
function getTitle(elements, anum){
  var elementQID = elements[anum].element.match(/(Q\d+)$/)[1];
  var params = `origin=*&action=wbgetentities&ids=${elementQID}&props=sitelinks/urls&languages=en&sitefilter=enwiki&exsectionformat=plain&formatversion=2&format=json`;
  var requestURL = encodeURI(wikidataEndpoint+params);

  return fetch(requestURL)
  .then(function(response){
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    return response.json();
  })
  .then(function(response){
    var enwikiData = response.entities[elementQID].sitelinks.enwiki;
    elements[anum].wikiurl = enwikiData.title;
    elements[anum].wikititle = enwikiData.title;
    return elements[anum];
  })
  .catch(error => {
    elements[anum].wikiurl = null;
    elements[anum].wikititle = null;
    Promise.reject(error); //Equivalent to rethrowing the error
  });
}

//See: https://www.mediawiki.org/wiki/Extension:TextExtracts
function getSummaryText(title){
  var params = `origin=*&action=query&prop=extracts&exintro=true&exlimit=2&titles=${title}&explaintext=1&formatversion=2&exchars=1024&format=json`;
  var requestURL = encodeURI(wikipediaEndpoint+params);   
  
  return fetch(requestURL)
  .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    return response.json();
  })
  .then(response => {
    return response.query.pages[0].extract;
  })
}

//Get data by querying wikidata and wikipedia 
async function getData(){
  var eset = await querySparql();  
  var promises = [];
  
  for (var anum in eset){
   var promise = getTitle(eset, anum)
   .then(element => {
     return getSummaryText(element.wikititle)
     .then(summary => {element.summary = summary;})
     .catch(error => {
       element.summary = null;
       console.error(error);
     });
    });
    
   promises.push(promise);
  }
  
  await Promise.all(promises);
  return eset;
}

//Transform wiki data into timeline json format
//See format here: http://timeline.knightlab.com/docs/json-format.html
async function transformToTLJson(){
  var timelineJson = {}
  timelineJson.events = []; // list of slide objects (each slide is an event)
  
  //wikiDate is in iso-8601 format 
  function parseDate(wikiDate){
    var wdate = new Date(wikiDate);
    
    return {
      year: wdate.getFullYear(),
      month: wdate.getMonth(),
      day: wdate.getDate(),
      hour: wdate.getHours(),
      minute: wdate.getMinutes(),
      second: wdate.getSeconds(),
      display_date: `Date of discovery: ${wdate.getFullYear()}`
    };

  }

  function newSlide(wikiElement){
    var slide = {};

    if (wikiElement.dateOfDiscovery){
      slide.start_date = parseDate(wikiElement.dateOfDiscovery);
    }else{
      slide.start_date = parseDate("0000-00-00T:00:00:00Z");
      slide.start_date.display_date = "Unknown discovery date";
    }

//     if (wikiElement.inventorLabel){

//     }
    
    //wikiElement.picture may be undefined.
    var summaryText = `${wikiElement.summary}`
    slide.text = {
                   headline: ` <a href="https://en.wikipedia.org/wiki/${wikiElement.wikiurl}">${wikiElement.elementLabel}</a>`,
                   text: createTable(wikiElement)
                 };

    slide.media = {
      url: "https://en.wikipedia.org/wiki/" + wikiElement.wikiurl,
      thumbnail: wikiElement.picture
    };
    slide.unique_id = "a"+wikiElement.anum;
    return slide;
  }

  var wikiData = await getData();
  for (var ekey in wikiData){
    timelineJson.events.push(newSlide(wikiData[ekey]));
  }
  return timelineJson;
}

function addImages(events){

  events.forEach(function(event){
    //Not all elements have images
    if(!event.media.thumbnail){
      return;
    }

    var anum = event.unique_id;
    var selector = `#${anum} > div.tl-slide-scrollable-container > div > div > div.tl-media`;  
    var insertionPoint = document.querySelector(selector);
    var img = document.createElement("img");
    img.setAttribute("class", "wikiImage");
    img.setAttribute("src", event.media.thumbnail);
    insertionPoint.appendChild(img);
    
  });
}

function createTable(tableObj){
  /*Take in a table object of the form:
  {th:tr, th:tr, ...} and return html*/

/* 
  var testobj = {
    "Symbol":"H",
    "Atomic Number": "1",
    "Discoverer": "Henry Cavendish",
    "Followed by": "helium",
    "Part of":"Period 1, Group 1",
    "Named after":"water",
    "Mass":"1.008",
    "Color":"colorless",
    "Boiling point": "-259.14C"
  }
*/
  var table = document.createElement("table");
  var tbody = document.createElement("tbody");
  table.setAttribute("class", "wiki-table");
  table.appendChild(tbody);
  
  Object.keys(tableObj).forEach(function(header){
    var rowContents = tableObj[header];
    var th = document.createElement("th");
    var td = document.createElement("td");
    var tr = document.createElement("tr");

    th.setAttribute("class", "wiki-th");
    td.setAttribute("class", "wiki-td");
    th.appendChild(document.createTextNode(header));
    td.appendChild(document.createTextNode(rowContents));
    tr.appendChild(th);
    tr.appendChild(td);
    tbody.appendChild(tr);
  })
  return table.outerHTML;
}

async function ar(){
    var result = await transformToTLJson();

    var timeline = new TL.Timeline('timeline-embed', result);
    timeline.on('loaded', function(...vars){
      addImages(result.events);
    });

// var anum = vars[0].events[0].unique_id;            
// var parent = document.querySelector(`#${anum} div.tl-text-content-container`);
// var a = parent.childNodes[0].cloneNode(true); //doi
// var b = parent.childNodes[1].cloneNode(true); //name
// var c = parent.childNodes[2].cloneNode(true); //text

// var addText = document.createElement("p");
// addText.appendChild(document.createTextNode("Greetings"));
// c.appendChild(addText);
// parent.replaceChildren(b,a,c);




// var h2t = document.querySelector('#a1 div.tl-text-content-container h2');
// var h3t = document.querySelector('#a1 div.tl-text-content-container h3');
// var pchild = parent.children;
// pchild[0] = h2t;
// pchild[1] = h3t;
// parent.replaceChildren(pchild);

//             h3t.textContent = "test";


}
ar();


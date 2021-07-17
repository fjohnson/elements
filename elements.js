var wikipediaUrl = "https://en.wikipedia.org/wiki/";
var wikiCommonsURL = 'https://commons.wikimedia.org/wiki/';
var sparqlEndpoint = "https://query.wikidata.org/sparql";
var wikidataEndpoint = "https://www.wikidata.org/w/api.php?";
var wikipediaEndpoint = "https://en.wikipedia.org/w/api.php?";

//Query the wikidata sparql endpoint 
function querySparql(query, parseFunction) {
    var params = "origin=*&format=json&query=";

    const options = {
        method: 'POST',
        body: encodeURI(params + query),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }

    return fetch(sparqlEndpoint, options).then(function(response) {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }).then(function(response) {
        return parseFunction(response);
    }).catch(error=>{
        console.log(error);
    }
    );
}

//Construct a set of prefixed ("wd:") element QIDs
function getElementWDSet(elements) {
    var elementQIDs = [];

    for (let element of Object.values(elements)) {
        let elementQID = element.element.match(/(Q\d+)$/)[1];
        elementQIDs.push('wd:' + elementQID);
    }

    return elementQIDs.join(',');
}

function genElementsQuery(){

    var atomicnumParam = new URL(window.location.href).searchParams.get("atomicnumbers");
    var atomicnums = [];
    if(atomicnumParam){
        atomicnums = atomicnumParam.split(',').filter((anum) => Number.isInteger(Number.parseInt(anum)));
    }
    var anumstr = atomicnums.join(',');
    var filter = atomicnums.length ? `FILTER (?anum in (${anumstr}))` : "FILTER (?anum <= 118)"; //Elements over 118 are currently only theoretical
    var getElementsQuery = `
    SELECT ?element ?elementLabel ?esymbol ?anum ?dateOfDiscovery ?locationOfDiscoveryLabel 
            ?densityUnitLabel ?densityAmount ?bpAmount ?bpUnitLabel ?massUnitLabel ?massAmount
            ?commons ?picture 
    WHERE {
        ?element wdt:P31 wd:Q11344;
                 wdt:P246 ?esymbol;
                 wdt:P1086 ?anum.

        optional { ?element wdt:P575 ?dateOfDiscovery. }
        optional { ?element wdt:P189 ?locationOfDiscovery}
        optional {?element wdt:P935 ?commons.}
        optional {?element wdt:P18 ?picture. }
        optional {?element p:P2102/psv:P2102 [wikibase:quantityAmount ?bpAmount; wikibase:quantityUnit ?bpUnit].}
        optional {?element p:P2054/psv:P2054 [wikibase:quantityUnit ?densityUnit; wikibase:quantityAmount ?densityAmount].}
        optional {?element p:P2067/psv:P2067 [wikibase:quantityUnit ?massUnit; wikibase:quantityAmount ?massAmount].}

        SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
        ${filter}
    }`;
    return getElementsQuery;

}
//Return a query to retrieve period, group, and electron configuration information
function genPartOfAndElectronConfQuery(elements) {

    var elementSet = getElementWDSet(elements);
    var query = `
  SELECT ?element ?anum ?pofLabel ?electronConfig
  WHERE {
      ?element wdt:P31 wd:Q11344;
               wdt:P361 ?pof;
               wdt:P8000 ?electronConfig;
               wdt:P1086 ?anum.
  
      SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
      FILTER (?element in (${elementSet}))
  }`;
    return query;
}

//Return a query to retrieve discoverers/inventors of elements
function genInventorsQuery(elements) {

    var elementSet = getElementWDSet(elements);
    var query = `
  SELECT ?element ?elementLabel ?esymbol ?anum 
       ?inventor ?inventorLabel ?inventordesc 
  WHERE {
    ?element wdt:P31 wd:Q11344;
             wdt:P246 ?esymbol;
             wdt:P1086 ?anum;
             wdt:P61 ?inventor.
    ?inventor schema:description ?inventordesc FILTER(LANG(?inventordesc) = "en").
    
    SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
    FILTER (?element in (${elementSet}))
  }`;
    return query;
}

//Get the URL of the wikipedia page corresponding to the wikidata element QID
function getWikiPage(wikiDataURL) {
    var QID = wikiDataURL.match(/(Q\d+)$/)[1];
    var params = `origin=*&action=wbgetentities&ids=${QID}&props=sitelinks/urls&languages=en&sitefilter=enwiki&exsectionformat=plain&formatversion=2&format=json`;
    var requestURL = encodeURI(wikidataEndpoint + params);

    return fetch(requestURL).then(function(response) {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }).then(function(response) {
        var enwikiData = response.entities[QID].sitelinks.enwiki;
        return encodeURI(wikipediaUrl + enwikiData.title);
    }).catch(error=>{
        return null;
        Promise.reject(error);
        //Equivalent to rethrowing the error
    }
    );
}

//Get data by querying wikidata and wikipedia 
async function getData() {

    function parseElements(sparql_json) {
        var queryVars = sparql_json.head.vars;
        var json_elements = sparql_json.results.bindings;
        var elements = {};

        json_elements.forEach(function(e) {
            var new_element = {};
            queryVars.forEach(function(v) {
                if (e[v]) {
                    new_element[v] = e[v].value;
                }
            });
            elements[new_element.anum] = new_element;
        })
        return elements;
    }

    var eset = await querySparql(genElementsQuery(), parseElements);

    function parsePeriodAndElectronConf(sparql_json) {

        for (let sparqlElement of sparql_json.results.bindings) {
            let anum = sparqlElement.anum.value;
            let partOf = sparqlElement.pofLabel.value;
            let electronConf = sparqlElement.electronConfig.value;

            if (eset[anum].electronConfig === undefined) {
                eset[anum].electronConfig = new Set();
            }
            eset[anum].electronConfig.add(electronConf);

            if (eset[anum].partOf === undefined) {
                eset[anum].partOf = new Set();
            }
            eset[anum].partOf.add(partOf);
        }

    }
    ;var electronQuery = querySparql(genPartOfAndElectronConfQuery(eset), parsePeriodAndElectronConf);

    function parseInventors(sparql_json) {
        for (let sparqlElement of sparql_json.results.bindings) {
            let anum = sparqlElement.anum.value;
            if (eset[anum].inventors === undefined) {
                eset[anum].inventors = [];
            }

            let inventor = {
                inventor: sparqlElement.inventor.value,
                inventorLabel: sparqlElement.inventorLabel.value,
                inventordesc: sparqlElement.inventordesc.value
            };
            eset[anum].inventors.push(inventor);
        }
    }

    await querySparql(genInventorsQuery(eset), parseInventors);

    var promises = [electronQuery];
    Object.values(eset).forEach(function(e) {
        let wikiUrlPromise = getWikiPage(e.element).then(function(result) {
            e["elementWikiUrl"] = result;
        });
        promises.push(wikiUrlPromise);
    });

    for (let e of Object.values(eset)) {
        if (e.inventors) {
            e.inventors.forEach(function(inventor) {
                let wikiUrlPromise = getWikiPage(inventor.inventor).then(function(result) {
                    inventor.wikiUrl = result;
                });
                promises.push(wikiUrlPromise);
            });
        }
    }

    await Promise.all(promises);
    return eset;
}

//Transform wiki data into timeline json format
//See format here: http://timeline.knightlab.com/docs/json-format.html
async function transformToTLJson() {
    var timelineJson = {}
    timelineJson.events = [];
    // list of slide objects (each slide is an event)

    //wikiDate is in iso-8601 format 
    function parseDate(wikiDate) {
        var wdate = new Date(wikiDate);

        return {
            year: wdate.getUTCFullYear(),
            month: wdate.getUTCMonth(),
            day: wdate.getUTCDate(),
            hour: wdate.getUTCHours(),
            minute: wdate.getUTCMinutes(),
            second: wdate.getUTCSeconds(),
            display_date: `Date of discovery: ${wdate.getUTCFullYear()}`
        };

    }

    function newSlide(wikiElement) {
        var slide = {};

        if (wikiElement.dateOfDiscovery) {
            if (wikiElement.dateOfDiscovery.startsWith('-')) {
                let year = wikiElement.dateOfDiscovery.match(/(-\d+)-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
                if (year) {
                    slide.start_date = {
                        year: year[1]
                    };
                } else {
                    slide.start_date = parseDate("0000-00-00T:00:00:00Z");
                    slide.start_date.display_date = "Unknown discovery date";
                }
            } else {
                slide.start_date = parseDate(wikiElement.dateOfDiscovery);
                if (isNaN(slide.start_date.year)) {
                    slide.start_date = parseDate("0000-00-00T:00:00:00Z");
                    slide.start_date.display_date = "Unknown discovery date";
                }
            }
        } else {
            slide.start_date = parseDate("0000-00-00T:00:00:00Z");
            slide.start_date.display_date = "Unknown discovery date";
        }

        slide.text = {
            headline: ` <a href="${wikiElement.elementWikiUrl}">${wikiElement.elementLabel}</a>`,
            text: createTable(selectTableData(wikiElement))
        };

        slide.media = {
            url: wikiElement.elementWikiUrl,
            thumbnail: wikiElement.picture
        };
        slide.unique_id = "a" + wikiElement.anum;
        slide.autolink = false;
        return slide;
    }

    var wikiData = await getData();
    for (var ekey in wikiData) {
        timelineJson.events.push(newSlide(wikiData[ekey]));
    }
    return timelineJson;
}

function selectTableData(wikiElement) {
    var tableData = {
        'Symbol': wikiElement.esymbol,
        'Atomic Number': wikiElement.anum,
    }

    if (wikiElement.partOf && wikiElement.partOf.size) {
        tableData['Part Of'] = Array.from(wikiElement.partOf).join(', ');
    }

    if (wikiElement.electronConfig && wikiElement.electronConfig.size) {
        for (let econf of wikiElement.electronConfig) {
            //Skip over electron configuration defined as e.g. [He] 2s¹
            if (!econf.startsWith('[')) {
                tableData['Electron Configuration'] = econf;
            }
        }
    }

    if (wikiElement.bpAmount && wikiElement.bpUnitLabel) {

        if (wikiElement.bpUnitLabel == 'degree Celsius') {
            tableData['Boiling Point'] = wikiElement.bpAmount + ' ' + 'C';
        } else if (wikiElement.bpUnitLabel == 'degree Fahrenheit') {
            tableData['Boiling Point'] = wikiElement.bpAmount + ' ' + 'F';
        } else {
            tableData['Boiling Point'] = wikiElement.bpAmount + ' ' + wikiElement.bpUnitLabel;
        }

    }

    if (wikiElement.densityUnitLabel && wikiElement.densityAmount) {
        tableData['Density'] = wikiElement.densityAmount + ' ' + wikiElement.densityUnitLabel;
    }

    if (wikiElement.massUnitLabel && wikiElement.massAmount) {
        if (wikiElement.massUnitLabel != '1') {
            tableData['Mass'] = wikiElement.massAmount + ' ' + wikiElement.massUnitLabel;
        } else {
            tableData['Mass'] = wikiElement.massAmount;
        }
    }

    var inventorList = [];
    var inventorWikiURLs = [];
    var inventorDescriptions = [];

    if (wikiElement.inventors) {
        for (let inventor of Object.values(wikiElement.inventors)) {
            inventorList.push(inventor.inventorLabel);
            inventorWikiURLs.push(inventor.wikiUrl);
            inventorDescriptions.push(inventor.inventordesc);
        }
    }

    if (inventorList.length) {
        tableData['Discovered by'] = inventorList.join(',');
        tableData['_inventorWikiUrls'] = inventorWikiURLs.join(',');
        tableData['Discoverer details'] = inventorDescriptions.join(', ');
    }

    if (wikiElement.locationOfDiscoveryLabel) {
        tableData['Discovered in'] = wikiElement.locationOfDiscoveryLabel;
    }

    tableData['Wikipedia'] = wikiElement.elementWikiUrl;
    tableData['Wikidata'] = wikiElement.element;
    if (wikiElement.commons) {
        tableData['Wikicommons'] = wikiCommonsURL + wikiElement.commons;
    }

    return tableData;
}

function createTable(tableObj) {
    /*Take in a table object of the form:
  {th:tr, th:tr, ...} and return html*/

    var table = document.createElement("table");
    var tbody = document.createElement("tbody");
    table.setAttribute("class", "wiki-table");
    table.appendChild(tbody);

    var inventorUrls = [];
    if (tableObj._inventorWikiUrls) {
        inventorUrls = tableObj._inventorWikiUrls.split(',');
        delete tableObj._inventorWikiUrls;
    }

    Object.keys(tableObj).forEach(function(header) {
        var rowContents = tableObj[header];
        var th = document.createElement("th");
        var td = document.createElement("td");
        var tr = document.createElement("tr");

        th.setAttribute("class", "wiki-th");
        td.setAttribute("class", "wiki-td");
        th.appendChild(document.createTextNode(header));

        if (header == 'Wikipedia' || header == 'Wikidata' || header == 'Wikicommons') {
            let link = document.createElement("a");
            link.setAttribute('href', rowContents);
            link.setAttribute("target", "_blank");
            link.setAttribute("rel", "no referrer noopener");
            link.appendChild(document.createTextNode(rowContents));
            td.appendChild(link);
        } else if (header == 'Discovered by') {
            let i = 0;
            for (let inventor of rowContents.split(',')) {
                let link = document.createElement("a");
                link.setAttribute('href', inventorUrls[i++]);
                link.setAttribute("target", "_blank");
                link.setAttribute("rel", "no referrer noopener");
                let delimiter = i < inventorUrls.length ? ', ' : '';
                link.appendChild(document.createTextNode(inventor + delimiter));
                td.appendChild(link);
            }
        } else {
            td.appendChild(document.createTextNode(rowContents));
        }

        tr.appendChild(th);
        tr.appendChild(td);
        tbody.appendChild(tr);
    });

    return table.outerHTML;
}

//var radioactiveElements = [43,61,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118];

async function ar() {
    var result = await transformToTLJson();
    var options = {
        //initial_zoom: 10,
        timenav_height_percentage: 20,
        //start_at_slide: 21
    }
    var timeline = new TL.Timeline('timeline-embed',result,options);

    function addImage(event) {

        //Not all elements have images
        if (!event.media.thumbnail) {
            return;
        }

        var anum = event.unique_id;
        var existing = document.querySelector(`#${anum} > div.tl-slide-scrollable-container > div > div > div.tl-media > a[href="${event.media.thumbnail}"]`);

        //slide has already been viewed and the image has been loaded
        if(existing){
            return;
        }

        var selector = `#${anum} > div.tl-slide-scrollable-container > div > div > div.tl-media`;
        var insertionPoint = document.querySelector(selector);
        var link = document.createElement("a");
        link.setAttribute("href", event.media.thumbnail);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "no referrer noopener");

        var img = document.createElement("img");
        img.setAttribute("class", "wikiImage");
        img.setAttribute("src", event.media.thumbnail);
        link.appendChild(img);
        insertionPoint.appendChild(link);
    }
    
    timeline.on('change', function(changeEventObj){
        addImage(timeline.getDataById(changeEventObj.unique_id));
    })
}
ar();

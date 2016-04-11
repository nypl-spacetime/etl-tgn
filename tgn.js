var fs = require('fs')
var path = require('path')
var SparqlClient = require('sparql-client')
var async = require('async')
var xml2js = require('xml2js')

// TGN configuration
var sparqlFiles = [
  'tgn-parents',
  'tgn-places',
  'tgn-terms'
]

var sparqlEndpoint = 'http://vocab.getty.edu/sparql.rdf'

function download (config, dirs, tools, callback) {
  async.eachSeries(sparqlFiles, function (sparqlFile, callback) {
    async.eachSeries(config.parents, function (parent, callback) {
      var client = new SparqlClient(sparqlEndpoint)
      var sparqlQuery = fs.readFileSync(path.join(__dirname, 'sparql', sparqlFile + '.sparql'), 'utf8')

      sparqlQuery = sparqlQuery.replace(new RegExp('{{ parent }}', 'g'), parent)

      client.query(sparqlQuery)
        .execute(function (err, results) {
          if (err) {
            callback(err)
            return
          }

          fs.writeFileSync(path.join(dirs.current, sparqlFile + '.' + parent.replace('tgn:', '') + '.xml'), results)
          callback()
        })
    },

      function (err) {
        callback(err)
      })
  },

    function (err) {
      callback(err)
    })
}

function transform (config, dirs, tools, callback) {
  var parser = new xml2js.Parser()

  async.eachSeries(sparqlFiles, function (sparqlFile, callback) {
    async.eachSeries(config.parents, function (parent, callback) {
      fs.readFile(path.join(dirs.previous, sparqlFile + '.' + parent.replace('tgn:', '') + '.xml'), function (err, data) {
        if (err) {
          callback(err)
          return
        }

        parser.parseString(data, (err, result) => {
          if (err) {
            callback(err)
            return
          }

          async.eachSeries(result['rdf:RDF']['rdf:Description'], function (element, callback) {
            parseElement(config, element, function (err) {
              callback(err)
            })
          },
          (err) => {
            callback(err)
          })
        })
      })
    },

      function (err) {
        callback(err)
      })
  },

    function (err) {
      callback(err)
    })

  function getElementTagValue (element, tag) {
    if (element[tag] && element[tag].length > 0 && element[tag][0]._) {
      return element[tag][0]._
    } else if (element[tag] && element[tag].length > 0) {
      return element[tag][0]
    }

    return null
  }

  function getElementTagAttribute (element, tag, attribute) {
    if (element[tag] && element[tag].length > 0 && element[tag][0].$ && element[tag][0].$[attribute]) {
      return element[tag][0].$[attribute]
    }

    return null
  }

  function parseElement (config, element, callback) {
    var elementType = getElementTagValue(element, 'tgn:typeTerm')
    var type = config.types[elementType]

    // Only process elements with valid type
    if (type) {
      var data = []

      var name = getElementTagValue(element, 'gvp:term')
      var uri = getElementTagAttribute(element, 'dct:source', 'rdf:resource')

      var pit = {
        uri: uri,
        name: name,
        type: type,
        data: {
          type: elementType
        }
      }

      var long = getElementTagValue(element, 'wgs:long')
      var lat = getElementTagValue(element, 'wgs:lat')
      if (long && lat) {
        pit.geometry = {
          type: 'Point',
          coordinates: [
            parseFloat(long),
            parseFloat(lat)
          ]
        }
      }

      var comment = getElementTagValue(element, 'rdfs:comment')
      if (comment) {
        pit.data.comment = comment
      }

      // TODO: use just years, and specify fuzziness!
      var estStart = getElementTagValue(element, 'gvp:estStart')
      var estEnd = getElementTagValue(element, 'gvp:estEnd')
      if (estStart) {
        pit.validSince = estStart
      }

      if (estEnd) {
        pit.validUntil = estEnd
      }

      data.push({
        type: 'pit',
        obj: pit
      })

      var broaderPreferred = getElementTagAttribute(element, 'gvp:broaderPreferred', 'rdf:resource')
      if (broaderPreferred) {
        // This implies that current PIT lies in broaderPreferred
        // Add liesIn relation
        data.push({
          type: 'relation',
          obj: {
            from: uri,
            to: broaderPreferred,
            type: config.relations.liesIn
          }
        })
      }

      var subject = getElementTagAttribute(element, 'rdf:subject', 'rdf:resource')
      if (subject) {
        // This implies that subject is an alternative name for current PIT
        // Add sameHgConcept relation
        data.push({
          type: 'relation',
          obj: {
            from: uri,
            to: subject,
            type: config.relations.equivalence
          }
        })
      }

      tools.writer.writeObjects(data, function (err) {
        callback(err)
      })
    } else {
      setImmediate(callback)
    }
  }
}

// ==================================== API ====================================

module.exports.steps = [
  download,
  transform
]

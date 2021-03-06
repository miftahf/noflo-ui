const noflo = require('noflo');
const octo = require('octo');

const githubGet = function(url, token, callback) {
  const api = octo.api();
  api.token(token);
  const request = api.get(url);
  request.on('success', function(res) {
    if (!res.body) {
      callback(new Error('No result received'));
      return;
    }
    return callback(null, res.body);
  });
  request.on('error', err => callback(err.body));
  return request();
};

const getTree = (repo, tree, token, callback) => githubGet(`/repos/${repo}/git/trees/${tree}`, token, callback);

const getCommit = (repo, sha, token, callback) => githubGet(`/repos/${repo}/git/commits/${sha}`, token, callback);

const processGraphsTree = function(tree, objects, prefix) {
  if (!tree) { return; }
  let graphs = tree.tree.filter(function(entry) {
    if (entry.type !== 'blob') { return false; }
    if (!entry.path.match('.*\.(fbp|json)$')) { return false; }
    return true;
  });
  graphs = graphs.filter(function(entry) {
    // If we have .json and .fbp for same graph, .json wins
    if (entry.path.indexOf('.fbp') === -1) { return true; }
    const jsonVersion = entry.path.replace('\.fbp', '.json');
    for (let g of Array.from(graphs)) {
      if (g.path === jsonVersion) { return false; }
    }
    return true;
  });
  return objects.graphs = objects.graphs.concat(graphs.map(function(entry) {
    entry.name = entry.path.substr(0, entry.path.indexOf('.'));
    entry.language = entry.path.substr(entry.path.lastIndexOf('.') + 1);
    entry.fullPath = `${prefix}${entry.path}`;
    return entry;
  })
  );
};

const processComponentsTree = function(tree, objects, prefix) {
  if (!tree) { return; }
  const components = tree.tree.filter(function(entry) {
    if (entry.type !== 'blob') { return false; }
    if (!entry.path.match('.*\.(coffee|js|hpp|c|py)$')) { return false; }
    return true;
  });
  return objects.components = objects.components.concat(components.map(function(entry) {
    entry.name = entry.path.substr(0, entry.path.indexOf('.'));
    const language = entry.path.substr(entry.path.lastIndexOf('.') + 1);
    switch (language) {
      case 'coffee': entry.language = 'coffeescript'; break;
      case 'js': entry.language = 'javascript'; break;
      case 'hpp': entry.language = 'c++'; break;
      case 'c': entry.language = 'c'; break;
      case 'py': entry.language = 'python'; break;
      default: entry.language = language;
    }
    entry.fullPath = `${prefix}${entry.path}`;
    return entry;
  })
  );
};

const processSpecsTree = function(tree, objects, prefix) {
  if (!tree) { return; }
  const specs = tree.tree.filter(function(entry) {
    if (entry.type !== 'blob') { return false; }
    if (!entry.path.match('.*\.(yaml|coffee)$')) { return false; }
    return true;
  });
  return objects.specs = objects.specs.concat(specs.map(function(entry) {
    entry.name = entry.path.substr(0, entry.path.indexOf('.'));
    entry.type = 'spec';
    const language = entry.path.substr(entry.path.lastIndexOf('.') + 1);
    switch (language) {
      case 'coffee': entry.language = 'coffeescript'; break;
      default: entry.language = language;
    }
    entry.fullPath = `${prefix}${entry.path}`;
    return entry;
  })
  );
};

const getRemoteObjects = (repo, sha, token, callback) =>
  getCommit(repo, sha, token, function(err, commit) {
    if (err) { return callback(err); }
    if (!commit) {
      return callback(new Error(`No commit found for ${repo} ${sha}`));
    }
    return getTree(repo, commit.tree.sha, token, function(err, rootTree) {
      if (err) { return callback(err); }

      let graphsSha = null;
      let componentsSha = null;
      let specsSha = null;
      const remoteObjects = {
        tree: commit.tree.sha,
        graphs: [],
        components: [],
        specs: []
      };
      for (let entry of Array.from(rootTree.tree)) {
        if ((entry.path === 'fbp.json') && (entry.type === 'blob')) {
          return callback(new Error('fbp.json support is pending standardization'));
        }
        if ((entry.path === 'graphs') && (entry.type === 'tree')) {
          graphsSha = entry.sha;
          continue;
        }
        if ((entry.path === 'components') && (entry.type === 'tree')) {
          componentsSha = entry.sha;
          continue;
        }
        if ((entry.path === 'spec') && (entry.type === 'tree')) {
          specsSha = entry.sha;
          continue;
        }
      }

      if (graphsSha) {
        getTree(repo, graphsSha, token, function(err, graphsTree) {
          if (err) { return callback(err); }
          processGraphsTree(graphsTree, remoteObjects, 'graphs/');
          if (!componentsSha) { return callback(null, remoteObjects); }
          return getTree(repo, componentsSha, token, function(err, componentsTree) {
            if (err) { return callback(err); }
            processComponentsTree(componentsTree, remoteObjects, 'components/');
            if (!specsSha) { return callback(null, remoteObjects); }
            return getTree(repo, specsSha, token, function(err, specsTree) {
              if (err) { return callback(err); }
              processSpecsTree(specsTree, remoteObjects, 'spec/');
              return callback(null, remoteObjects);
            });
          });
        });
        return;
      }

      if (componentsSha) {
        getTree(repo, componentsSha, token, function(err, componentsTree) {
          if (err) { return callback(err); }
          processComponentsTree(componentsTree, remoteObjects, 'components/');
          if (!specsSha) { return callback(null, remoteObjects); }
          return getTree(repo, specsSha, token, function(err, specsTree) {
            if (err) { return callback(err); }
            processSpecsTree(specsTree, remoteObjects, 'spec/');
            return callback(null, remoteObjects);
          });
        });
        return;
      }

      if (specsSha) {
        getTree(repo, specsSha, token, function(err, specsTree) {
          if (err) { return callback(err); }
          processSpecsTree(specsTree, remoteObjects, 'spec/');
          return callback(null, remoteObjects);
        });
        return;
      }

      // No graphs or components on the remote
      return callback(null, remoteObjects);
    });
  })
;

const normalizeName = name => name.replace(/\s/g, '_');

const createPath = function(type, entity) {
  const name = normalizeName(entity.name);
  if (type === 'graph') {
    return `graphs/${name}.json`;
  }
  let componentDir = 'components';
  if (type === 'spec') { componentDir = 'spec'; }
  switch (entity.language) {
    case 'coffeescript': return `${componentDir}/${name}.` + 'coffee';
    case 'javascript': return `${componentDir}/${name}.js`;
    case 'es2015': return `${componentDir}/${name}.js`;
    case 'c++': return `${componentDir}/${name}.hpp`;
    case 'python': return `${componentDir}/${name}.py`;
    default: return `${componentDir}/${name}.${entity.language}`;
  }
};

const addToPull = (type, local, remote, operations) =>
  operations.pull.push({
    path: remote.fullPath,
    type,
    local,
    remote
  })
;
const addToPush = (type, local, remote, operations) =>
  operations.push.push({
    path: (remote != null ? remote.fullPath : undefined) || createPath(type, local),
    type,
    local,
    remote
  })
;
const addToConflict = (type, local, remote, operations) =>
  operations.conflict.push({
    path: remote.fullPath,
    type,
    local,
    remote
  })
;

exports.getComponent = function() {
  const c = new noflo.Component;
  c.inPorts.add('reference',
    {datatype: 'object'});
  c.inPorts.add('project',
    {datatype: 'object'});
  c.inPorts.add('token', {
    datatype: 'string',
    required: true
  }
  );
  c.outPorts.add('noop',
    {datatype: 'object'});
  c.outPorts.add('local',
    {datatype: 'object'});
  c.outPorts.add('remote',
    {datatype: 'object'});
  c.outPorts.add('both',
    {datatype: 'object'});
  c.outPorts.add('error',
    {datatype: 'object'});

  noflo.helpers.WirePattern(c, {
    in: ['reference', 'project'],
    params: 'token',
    out: ['noop', 'local', 'remote', 'both'],
    async: true
  }
  , function(data, groups, out, callback) {
    const operations = {
      repo: data.project.repo,
      project: data.project,
      ref: data.reference.ref,
      commit: data.reference.object.sha,
      push: [],
      pull: [],
      conflict: []
    };

    return getRemoteObjects(operations.repo, operations.commit, c.params.token, function(err, objects) {
      let matching, remoteComponent, remoteGraph, remoteSpec;
      if (err) { return callback(err); }
      operations.tree = objects.tree;

      for (remoteGraph of Array.from(objects.graphs)) {
        matching = data.project.graphs.filter(function(localGraph) {
          if (localGraph.properties.sha === remoteGraph.sha) { return true; }
          if (normalizeName(localGraph.name) === remoteGraph.name) { return true; }
          return false;
        });
        if (!matching.length) {
          // No local version, add to pull
          addToPull('graph', null, remoteGraph, operations);
          continue;
        }
        if (matching[0].properties.sha === remoteGraph.sha) {
          // Updated local version
          if (matching[0].properties.changed) { addToPush('graph', matching[0], remoteGraph, operations); }
          continue;
        }
        if (matching[0].properties.changed === false) {
          addToPull('graph', matching[0], remoteGraph, operations);
          continue;
        }
        addToConflict('graph', matching[0], remoteGraph, operations);
      }

      let localOnly = data.project.graphs.filter(function(localGraph) {
        let notPushed = true;
        for (remoteGraph of Array.from(objects.graphs)) {
          if (localGraph.properties.sha === remoteGraph.sha) { notPushed = false; }
          if (normalizeName(localGraph.name) === remoteGraph.name) { notPushed = false; }
        }
        return notPushed;
      });
      for (let localGraph of Array.from(localOnly)) { addToPush('graph', localGraph, null, operations); }

      for (remoteComponent of Array.from(objects.components)) {
        matching = data.project.components.filter(function(localComponent) {
          if (localComponent.sha === remoteComponent.sha) { return true; }
          if (normalizeName(localComponent.name) === remoteComponent.name) { return true; }
          return false;
        });
        if (!matching.length) {
          // No local version, add to pull
          addToPull('component', null, remoteComponent, operations);
          continue;
        }
        if (matching[0].sha === remoteComponent.sha) {
          // Updated local version
          if (matching[0].changed) { addToPush('component', matching[0], remoteComponent, operations); }
          continue;
        }
        if (matching[0].changed === false) {
          addToPull('component', matching[0], remoteComponent, operations);
          continue;
        }
        addToConflict('component', matching[0], remoteComponent, operations);
      }

      localOnly = data.project.components.filter(function(localComponent) {
        if (!localComponent.code.length) { return false; }
        let notPushed = true;
        for (remoteComponent of Array.from(objects.components)) {
          if (localComponent.sha === remoteComponent.sha) { notPushed = false; }
          if (normalizeName(localComponent.name) === remoteComponent.name) { notPushed = false; }
        }
        return notPushed;
      });
      for (let localComponent of Array.from(localOnly)) { addToPush('component', localComponent, null, operations); }

      for (remoteSpec of Array.from(objects.specs)) {
        matching = data.project.specs.filter(function(localSpec) {
          if (localSpec.sha === remoteSpec.sha) { return true; }
          if (normalizeName(localSpec.name) === remoteSpec.name) { return true; }
          return false;
        });
        if (!matching.length) {
          // No local version, add to pull
          addToPull('spec', null, remoteSpec, operations);
          continue;
        }
        if (matching[0].sha === remoteSpec.sha) {
          // Updated local version
          if (matching[0].changed) { addToPush('spec', matching[0], remoteSpec, operations); }
          continue;
        }
        if (matching[0].changed === false) {
          addToPull('spec', matching[0], remoteSpec, operations);
          continue;
        }
        addToConflict('spec', matching[0], remoteSpec, operations);
      }

      localOnly = data.project.specs.filter(function(localSpec) {
        if (!localSpec.code.length) { return false; }
        let notPushed = true;
        for (remoteSpec of Array.from(objects.specs)) {
          if (localSpec.sha === remoteSpec.sha) { notPushed = false; }
          if (normalizeName(localSpec.name) === remoteSpec.name) { notPushed = false; }
        }
        return notPushed;
      });
      for (let localSpec of Array.from(localOnly)) { addToPush('spec', localSpec, null, operations); }

      if (operations.conflict.length) {
        out.both.send(operations);
        callback();
        return;
      }

      if (operations.push.length && operations.pull.length) {
        out.both.send(operations);
        callback();
        return;
      }

      if (operations.push.length) {
        out.local.send(operations);
        callback();
        return;
      }

      if (operations.pull.length) {
        out.remote.send(operations);
        callback();
        return;
      }

      out.noop.send(operations);
      return callback();
    });
  });

  return c;
};

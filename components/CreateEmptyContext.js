const noflo = require('noflo');

const buildContext = function() {
  let ctx;
  return ctx =
    {state: ''};
};

exports.getComponent = function() {
  const c = new noflo.Component;
  c.icon = 'file-o';
  c.inPorts.add('start',
    {datatype: 'bang'});
  c.outPorts.add('out',
    {datatype: 'object'});

  return noflo.helpers.WirePattern(c, {
    in: 'start',
    out: 'out',
    async: true
  }
  , function(data, groups, out, callback) {
    const ctx = buildContext();
    ctx.state = 'ok';
    out.send(ctx);
    return callback();
  });
};

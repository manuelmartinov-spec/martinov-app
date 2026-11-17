// Cloudflare Worker „martinov-alarmi“: svakog minuta pokrene robota (robot.mjs).
import { tick } from './robot.mjs';

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(tick(env).then(r => {
      if (r && (r.alarmi || r.jutro || (r.greske && r.greske.length) || r.skip)) console.log('robot', JSON.stringify(r));
    }).catch(e => console.error('GREŠKA', e && e.message)));
  },
  async fetch() {
    return new Response('Martinov alarmi – robot radi svakog minuta.', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};

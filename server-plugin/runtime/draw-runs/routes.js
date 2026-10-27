'use strict';

const DRAW_RUNS_PATH = '/v1/draw-runs';

// The removed planner never persisted in-memory runs across restarts.
// Keep the read contract so clients can retire stale planning records.
function registerDrawRunRoutes(router) {
    function owned(handler) {
        return (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            const owner = req.user?.profile?.handle;
            if (typeof owner !== 'string' || !owner) return res.status(403).send({
                ok: false, code: 'authenticated_profile_required', error: '请先登录酒馆',
            });
            return handler(req, res);
        };
    }
    const missing = owned((_req, res) => res.status(404).send({
        ok: false, code: 'draw_run_not_found', error: '旧规划任务已不存在',
    }));
    router.post(DRAW_RUNS_PATH, owned((_req, res) => res.status(410).send({
        ok: false, code: 'scene_planning_removed', error: '场景规划已移除，请刷新酒馆使用剧情直出。',
    })));
    router.get(DRAW_RUNS_PATH, owned((_req, res) => res.status(200).send({ ok: true, runs: [] })));
    router.get(`${DRAW_RUNS_PATH}/:runId`, missing);
    router.post(`${DRAW_RUNS_PATH}/:runId/cancel`, missing);
    router.delete(`${DRAW_RUNS_PATH}/:runId`, missing);
}

module.exports = { DRAW_RUNS_PATH, registerDrawRunRoutes };

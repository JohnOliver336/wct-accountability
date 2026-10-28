// Deletes MT5 screenshots of trades older than RETENTION_DAYS from the private
// "executions" bucket, so the free 1 GB never fills up. The trade itself (numbers,
// thought process, marks, scores) is kept; the row is stamped with images_removed_at
// and the site shows "screenshot removed" instead of the picture.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const RETENTION_DAYS = Number(Deno.env.get('SCREENSHOT_RETENTION_DAYS') ?? 60);
const BATCH = 100;

Deno.serve(async () => {
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString().slice(0, 10);

    let trades = 0, files = 0;
    for (;;) {
      const { data: rows, error } = await sb.from('trade_posts')
        .select('id, mt5_path, chart_path')
        .lt('date', cutoff)
        .is('images_removed_at', null)
        .limit(BATCH);
      if (error) throw error;
      if (!rows?.length) break;

      const paths = rows.flatMap((r) => [r.mt5_path, r.chart_path]).filter((p): p is string => !!p && p !== 'sample');
      if (paths.length) {
        const { error: rmErr } = await sb.storage.from('executions').remove(paths);
        if (rmErr) throw rmErr;
      }
      const { error: upErr } = await sb.from('trade_posts')
        .update({ images_removed_at: new Date().toISOString() })
        .in('id', rows.map((r) => r.id));
      if (upErr) throw upErr;

      trades += rows.length;
      files += paths.length;
      if (rows.length < BATCH) break;
    }
    return Response.json({ ok: true, retention_days: RETENTION_DAYS, cutoff, trades, files_deleted: files });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message ?? e) }, { status: 500 });
  }
});

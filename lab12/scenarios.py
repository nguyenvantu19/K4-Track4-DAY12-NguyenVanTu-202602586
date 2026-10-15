"""Step 2: scenarios. Metrics (TTC, required deceleration), mining braking events from the logs, and the physics
frontier that separates 'no planner could have avoided this' from 'this planner failed'."""
import numpy as np

from . import config as C


def ttc(gap, closing):
    """Time to collision [s] = gap / closing speed (inf when the gap is not closing)."""
    # TODO (Bước 2): hãy tự cài hàm này. Gợi ý:
    #   TTC = gap / closing khi closing > 0, ngược lại inf. Phải chạy được trên mảng numpy (dùng np.where,
    #   tránh chia cho 0).
    gap, closing = np.broadcast_arrays(np.asarray(gap, float), np.asarray(closing, float))
    return np.divide(gap, closing, out=np.full(gap.shape, np.inf), where=closing > 0)


def required_decel(gap, closing):
    """Deceleration [m/s^2] needed to remove the closing speed exactly at contact: closing^2 / (2 gap)."""
    # TODO (Bước 2): hãy tự cài hàm này. Gợi ý:
    #   closing^2 / (2 * gap) khi closing > 0, ngược lại 0. Ví dụ của slide: gap 12 m, closing 5 m/s -> 1,04
    #   m/s^2.
    gap, closing = np.broadcast_arrays(np.asarray(gap, float), np.asarray(closing, float))
    out = np.zeros(gap.shape)
    np.divide(closing ** 2, 2 * gap, out=out, where=(closing > 0) & (gap > 0))
    return np.where((closing > 0) & (gap <= 0), np.inf, out)


def unavoidable(gaps, dvs, t_react=0.0, b_max=C.B_MAX):
    """Boolean grid (len(dvs), len(gaps)): True where NO planner can avoid contact, even braking at b_max after the
    reaction delay: gap < dv * t_react + dv^2 / (2 b_max)  (lead keeps its speed)."""
    # TODO (Bước 2): hãy tự cài hàm này. Gợi ý:
    #   Hãy tự suy ra biên. Trong t_react xe vẫn giữ tốc độ nên khoảng cách co lại dv * t_react. Sau đó
    #   phanh b_max cần dv^2 / (2 * b_max) để triệt tiêu tốc độ tiến gần. Bất khả thi khi gap nhỏ hơn tổng
    #   hai đoạn đó. Dùng np.meshgrid(gaps, dvs) để kết quả có shape (len(dvs), len(gaps)). Với dv = 0 phải
    #   luôn tránh được.
    gap, dv = np.meshgrid(np.asarray(gaps, float), np.asarray(dvs, float))
    stopping_distance = dv * t_react + dv ** 2 / (2 * b_max)
    return (dv > 0) & (gap < stopping_distance)


def mine_braking(logs, threshold=C.BRAKE_THRESHOLD, min_steps=5):
    """Find trajectories where the lead brakes: smoothed deceleration below `threshold` for at least `min_steps`
    consecutive steps (0.5 s). Returns a list of event dicts (one per trajectory, first event only)."""
    # TODO (Bước 2): hãy tự cài hàm này. Gợi ý:
    #   Với mỗi quỹ đạo i: a = logs.a_lead[i, :logs.n[i]] (đã làm mượt; KHÔNG dùng acc_lead_raw). Tìm lần
    #   ĐẦU TIÊN có đủ min_steps bước liên tiếp a < threshold. onset_step = bước bắt đầu chuỗi đó. Mỗi quỹ
    #   đạo tối đa 1 sự kiện. Trả list dict có đúng các khoá: traj, onset_step, peak_decel (a nhỏ nhất trong
    #   chuỗi), gap_m (logs.gap[i, onset]), closing_m_s (logs.v_ego[i, onset] - logs.v_lead_s[i, onset]),
    #   ego_speed (logs.v_ego[i, onset]).
    events = []
    for i in range(len(logs)):
        a = logs.a_lead[i, :logs.n[i]]
        braking = a < threshold
        starts = np.flatnonzero(braking & ~np.r_[False, braking[:-1]])
        ends = np.flatnonzero(braking & ~np.r_[braking[1:], False]) + 1
        for onset, end in zip(starts, ends):
            if end - onset < min_steps:
                continue
            events.append({"traj": i, "onset_step": int(onset),
                           "peak_decel": float(a[onset:end].min()),
                           "gap_m": float(logs.gap[i, onset]),
                           "closing_m_s": float(logs.v_ego[i, onset] - logs.v_lead_s[i, onset]),
                           "ego_speed": float(logs.v_ego[i, onset])})
            break
    return events


def human_brake_limit(logs, q=0.1):
    """Hardest braking [m/s^2, positive number] that the logged human followers ever applied (the q-th percentile of
    their acceleration, from the speed differences). Learned planners cannot have seen anything harder."""
    a = np.diff(logs.v_ego, axis=1) / C.DT
    return float(-np.nanpercentile(a, q))


def grid_from_logs(logs, v_ego, n_gap=60, n_dv=45):
    """Scenario grid. Gap limits come from what the logs contain (p2 .. p98 of the logged gaps). Closing speed runs
    from 0 to v_ego: dv = v_ego means the cutter is standing still, the most extreme case (never faster than that,
    otherwise the cutter would drive backwards)."""
    g_lo, g_hi = np.nanpercentile(logs.gap, [2, 98])
    return np.linspace(g_lo, g_hi, n_gap), np.linspace(0.0, v_ego, n_dv)

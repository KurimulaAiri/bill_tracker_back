#!/usr/bin/env python3
"""验证请求签名 + 防重放：HMAC-SHA256 算法与 NestJS 端一致"""
import hashlib
import hmac
import json
import time
import uuid
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
SECRET = "bill-tracker-sign-secret-change-me"


def sort_keys(obj):
    if isinstance(obj, list):
        return [sort_keys(i) for i in obj]
    if isinstance(obj, dict):
        return {k: sort_keys(obj[k]) for k in sorted(obj)}
    return obj


def normalized_body(body):
    if body is None:
        return ""
    return json.dumps(sort_keys(body), ensure_ascii=False, separators=(",", ":"))


def normalized_query(q):
    if not q:
        return ""
    return "&".join(f"{k}={v}" for k, v in sorted(q.items()))


def make_sign(method, path, query=None, body=None):
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex
    canonical = "\n".join([method.upper(), path, normalized_query(query or {}),
                           normalized_body(body), ts, nonce])
    sig = hmac.new(SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return ts, nonce, sig


def req(method, path, query=None, body=None, headers=None):
    url = BASE + path
    if query:
        url += "?" + "&".join(f"{k}={v}" for k, v in query.items())
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# 注意：签名 path 用完整路径（含 /api 前缀，与后端 originalUrl 一致）
P_ME = "/api/auth/me"
P_LOGIN = "/api/auth/login"

print("== 1. 无签名请求，应 401 ==")
s, b = req("GET", P_ME)
print(f"  status={s} {b[:60]}")

print("== 2. 带签名但未登录，应 401 未登录 ==")
ts, nonce, sig = make_sign("GET", P_ME)
s, b = req("GET", P_ME, headers={"X-Timestamp": ts, "X-Nonce": nonce, "X-Sign": sig})
print(f"  status={s} {b[:60]}")

print("== 3. 签名正确登录，应 201/200 返回 token ==")
body = {"username": "sigtest", "password": "sigtest123"}
ts, nonce, sig = make_sign("POST", P_LOGIN, body=body)
s, b = req("POST", P_LOGIN, body=body, headers={"X-Timestamp": ts, "X-Nonce": nonce, "X-Sign": sig})
print(f"  status={s} {b[:100]}")

print("== 4. 重放相同请求（同 ts/nonce/sign），应 401 ==")
s, b = req("POST", P_LOGIN, body=body, headers={"X-Timestamp": ts, "X-Nonce": nonce, "X-Sign": sig})
print(f"  status={s} {b[:60]}")

print("== 5. 篡改 body 后重签新 nonce，应 401 ==")
fake = dict(body); fake["password"] = "wrong"
ts2, nonce2, sig2 = make_sign("POST", P_LOGIN, body=fake)
s, b = req("POST", P_LOGIN, body=fake, headers={"X-Timestamp": ts2, "X-Nonce": nonce2, "X-Sign": sig2})
print(f"  status={s} {b[:60]}")

print("DONE")
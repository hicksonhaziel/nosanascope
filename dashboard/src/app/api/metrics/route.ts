import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getAgentBaseUrl() {
  const raw = process.env.AGENT_API_BASE_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams.toString();
  const upstreamUrl = `${getAgentBaseUrl()}/api/metrics${searchParams ? `?${searchParams}` : ""}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to proxy metrics endpoint",
      },
      { status: 502 }
    );
  }
}


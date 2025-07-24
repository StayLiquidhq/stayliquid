import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    // Prepare response to manage cookies
    const response = NextResponse.next()

    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name) {
            return request.cookies.get(name)?.value
          },
          set(name, value, options) {
            response.cookies.set(name, value, options)
          },
          remove(name, options) {
            response.cookies.set(name, '', { ...options, maxAge: -1 })
          },
        },
      }
    )

    // Get the currently authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { data: null, error: "Unauthorized", status: 401 },
        { status: 401 }
      )
    }

    // Use the Supabase user ID (or google_id if that's how you're storing it)
    const google_id = user.id

    // Fetch the user's profile from your own 'users' table
    const { data, error } = await supabase
      .from('users')
      .select('username, picture, is_verified, wallet_address, name, email')
      .eq('google_id', google_id) // or 'user_id' if that's your column
      .single()

    if (error) {
      console.error('DB error:', error)
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { data: null, error: "User not found", status: 404 },
          { status: 404 }
        )
      }

      return NextResponse.json(
        { data: null, error: "Internal server error", status: 500 },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { data, error: null, status: 200 },
      { status: 200 }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { data: null, error: "Internal server error", status: 500 },
      { status: 500 }
    )
  }
}
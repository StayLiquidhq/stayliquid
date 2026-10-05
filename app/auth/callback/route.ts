import { NextRequest, NextResponse } from 'next/server'
import createSupabaseServerClient from '@/lib/supabase/serverClient'

export async function GET(request: NextRequest) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')

    if (!code) {
        return NextResponse.redirect(`${origin}/auth/auth-code-error`)
    }

    try {
        const response = NextResponse.redirect(`${origin}/auth/auth-code-error`)
        const supabase = createSupabaseServerClient(request, response)

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

        if (exchangeError) throw exchangeError

        const { data: { user }, error: userError } = await supabase.auth.getUser()

        if (userError || !user) throw userError || new Error('No user found')

        const userResponse = await fetch(`${origin}/api/user/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: user.user_metadata.email,
                name: user.user_metadata.full_name,
                picture: user.user_metadata.picture || null,
                google_id: user.id
            })
        })

        const userData = await userResponse.json()

        if (userData.error) throw new Error(userData.error)

        const redirectUrl = userData.new ? `${origin}/onboarding` : `${origin}/dashboard`

        return NextResponse.redirect(redirectUrl, { 
            status: 302,
            headers: response.headers 
        })

    } catch (error) {
        console.error('Callback error:', error)

        return NextResponse.redirect(`${origin}/auth/auth-code-error`)
    }
}

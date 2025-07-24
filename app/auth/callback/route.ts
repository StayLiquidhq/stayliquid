import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')

    if (code) {
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return request.cookies.get(name)?.value
                    },
                    set(name: string, value: string, options: any) {
                        // We'll set cookies on the final response
                    },
                    remove(name: string, options: any) {
                        // We'll handle cookie removal on the final response
                    },
                },
            }
        )

        const { error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error) {
            const { data: { user } } = await supabase.auth.getUser()
            
            if (user) {
                const email = user.user_metadata.email
                const name = user.user_metadata.full_name
                const picture = user.user_metadata.picture || null
                const google_id = user.id

                try {
                    // Call your user creation/fetch API
                    const userResponse = await fetch(`${origin}/api/users/create`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            email,
                            name,
                            picture,
                            google_id
                        })
                    })

                    const userData = await userResponse.json()

                    if (userData.error) {
                        console.error('Error creating/fetching user:', userData.error)
                        return NextResponse.redirect(`${origin}/auth/auth-code-error`)
                    }

                    // Create the final response with proper cookie handling
                    let redirectUrl = `${origin}/dashboard`
                    
                    // If it's a new user, you might want to redirect to onboarding
                    if (userData.new) {
                        redirectUrl = `${origin}/onboarding` // or keep dashboard if you handle onboarding there
                    }

                    const response = NextResponse.redirect(redirectUrl)

                    // Re-create supabase client with proper cookie handling for the response
                    const supabaseForCookies = createServerClient(
                        process.env.NEXT_PUBLIC_SUPABASE_URL!,
                        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                        {
                            cookies: {
                                get(name: string) {
                                    return request.cookies.get(name)?.value
                                },
                                set(name: string, value: string, options: any) {
                                    response.cookies.set(name, value, options)
                                },
                                remove(name: string, options: any) {
                                    response.cookies.set(name, '', { ...options, maxAge: -1 })
                                },
                            },
                        }
                    )

                    // This ensures the session cookies are properly set
                    await supabaseForCookies.auth.exchangeCodeForSession(code)

                    return response

                } catch (fetchError) {
                    console.error('Error calling user API:', fetchError)
                    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
                }
            }
        }
    }

    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
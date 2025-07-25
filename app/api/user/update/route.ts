import createSupabaseServerClient from '@/lib/supabase/serverClient'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(request: NextRequest) {
    try {
        // Ensure required env vars exist
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
            throw Error('Missing environment variables')
        }

        // Prepare the response object (required to set cookies securely)
        const response = NextResponse.next()

        // Initialize Supabase server client with cookie methods
        const supabase = createSupabaseServerClient(request, response)

        // Get the currently logged-in Supabase user
        const { data: { user }, error: userError } = await supabase.auth.getUser()

        if (userError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        // Parse request body to get the fields to be updated
        const body = await request.json()
        const { username, name, phone_number, is_verified, picture } = body

        // Fetch current user data from your custom `users` table using their Supabase Auth ID (google_id here)
        const { data: oldData, error: oldDataError } = await supabase
            .from('users')
            .select('*')
            .eq('google_id', user.id)
            .single()

        if (oldDataError || !oldData) {
            return NextResponse.json({ success: false, error: 'User not found in DB' }, { status: 404 })
        }

        // Destructure old data to use as fallbacks for missing fields
        const {
            username: oldUsername,
            name: oldName,
            phone_number: oldPhone_number,
            is_verified: oldIs_verified,
            picture: oldPicture,
        } = oldData

        // Perform the update — use new values if provided, otherwise fallback to old
        const { error: updateError } = await supabase
            .from('users')
            .update({
                username: username || oldUsername,
                name: name || oldName,
                phone_number: phone_number || oldPhone_number,
                is_verified: is_verified ?? oldIs_verified, // Using nullish coalescing to allow false
                picture: picture || oldPicture,
            })
            .eq('google_id', user.id)

        if (updateError) {
            return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
        }

        return NextResponse.json({ success: true }, { status: 200 })

    } catch (error) {
        console.error('Update failed:', error)
        return NextResponse.json({ success: false, error: 'Failed to update user' }, { status: 500 })
    }
}

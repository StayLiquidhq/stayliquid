import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import privy from "@/utils/privy";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { email, name, picture, google_id } = body;

        // Validate required fields
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            return NextResponse.json({
                error: "Valid email address is required",
                data: null,
                new: false,
                status: 400
            });
        }

        const cleanEmail = email.toLowerCase().trim();
        const username = cleanEmail.split("@")[0];

        // Try to find existing user first
        const { data: existingUser, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('email', cleanEmail)
            .single();

        // If user exists, return them
        if (existingUser && !fetchError) {
            // Optionally update their info (like profile picture) if it's changed
            const { data: updatedUser, error: updateError } = await supabase
                .from('users')
                .update({
                    name: name.trim(),
                    picture: picture || existingUser.picture
                })
                .eq('id', existingUser.id)
                .select()
                .single();

            if (updateError) {
                console.error('Error updating existing user:', updateError);
                // Still return the existing user even if update fails
                return NextResponse.json({
                    error: null,
                    data: existingUser,
                    new: false,
                    status: 200
                });
            }

            return NextResponse.json({
                error: null,
                data: updatedUser,
                new: false,
                status: 200
            });
        }

        // If user doesn't exist (and it's not a different error), create new user
        if (fetchError && fetchError.code === 'PGRST116') {

            const {id, address} = await privy.walletApi.createWallet({chainType: 'solana'});

            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert([
                    {
                        email: cleanEmail,
                        privy_id: id,
                        name: name.trim(),
                        wallet_address: address,
                        username: username.toLowerCase(),
                        picture: picture || null,
                        google_id: google_id || null
                    }
                ])
                .select()
                .single();

            if (insertError) {
                console.error('Error creating new user:', insertError);
                return NextResponse.json({
                    error: "Failed to create user account",
                    data: null,
                    new: false,
                    status: 500
                });
            }

            return NextResponse.json({
                error: null,
                data: newUser,
                new: true,
                status: 200
            });
        }

        // If there was a different database error
        console.error('Database error:', fetchError);
        return NextResponse.json({
            error: "Database error occurred",
            data: null,
            new: false,
            status: 500
        });

    } catch (error) {
        console.error('Unexpected error:', error);
        return NextResponse.json({
            error: "Internal server error",
            data: null,
            new: false,
            status: 500
        });
    }
}